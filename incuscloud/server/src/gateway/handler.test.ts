import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:https";
import { connect } from "node:tls";
import { eq } from "drizzle-orm";
import { clusters, placements, sessions } from "../db/schema.ts";
import { syncAll } from "../authz/sync.ts";
import { createFront } from "../front.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { harness, type Actor } from "../test/harness.ts";
import { createGateway, type GatewayRequest } from "./handler.ts";
import { ClusterCache } from "./clusters-cache.ts";
import { Upstreams } from "./relay.ts";

const tls = { cert: readFileSync(new URL("../test/fixtures/test.crt", import.meta.url)), key: readFileSync(new URL("../test/fixtures/test.key", import.meta.url)) };
const ca = tls.cert.toString();
let fake: FakeIncus;
let h: Awaited<ReturnType<typeof harness>>;
let server: Server;
let port: number;
let cache: ClusterCache;
let clusterId: string;
let member: Actor;
let outsider: Actor;
let logged: GatewayRequest[];

beforeAll(async () => {
  fake = await new FakeIncus().start();
});
afterAll(() => fake.stop());
beforeEach(async () => {
  server?.close();
  h = await harness();
  const [c] = await h.db.insert(clusters).values({ name: "c1", url: fake.url, fingerprint: fake.fingerprint, serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning();
  clusterId = c!.id;
  const t = await h.tenant("acme");
  await h.db.insert(placements).values({ tenantId: t.id, clusterId, project: "acme" });
  member = await h.user("m@example.com", { tenants: { [t.id]: "member" } });
  outsider = await h.user("o@example.com");
  await syncAll(h.db, h.authz);
  cache = new ClusterCache(h.db, 0);
  logged = [];
  const gateway = createGateway({ ...h.deps, clusterDomain: "clusters.test", clusters: cache, upstreams: new Upstreams(), onRequest: (r) => logged.push(r) });
  server = createFront({ app: h.app, gateway, tls });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

const call = async (path: string, o: { host?: string; token?: string; cookie?: string; method?: string; origin?: string } = {}) => {
  const headers: Record<string, string> = { host: o.host ?? "cloud.test" };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin) headers.origin = o.origin;
  const r = await fetch(`https://127.0.0.1:${port}${path}`, { method: o.method ?? "GET", headers, tls: { ca, checkServerIdentity: () => undefined } } as RequestInit);
  const text = await r.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status, body };
};

async function sessionCookie(userId: string) {
  const id = `sess-${crypto.randomUUID()}`;
  const accessToken = await h.sign({ sub: userId });
  await h.db.insert(sessions).values({ id: createHash("sha256").update(id).digest("hex"), userId, accessToken, expiresAt: new Date(Date.now() + 3600e3) });
  return { cookie: `ic_session=${id}`, accessToken };
}

test("unknown clusters are an Incus-shaped 404", async () => {
  const r = await call("/1.0", { host: "nope.clusters.test" });
  expect(r.status).toBe(404);
  expect(r.body).toMatchObject({ type: "error", error_code: 404 });
});

test("anonymous GET /1.0 reaches the cluster without credentials", async () => {
  const r = await call("/1.0", { host: "c1.clusters.test" });
  expect(r.status).toBe(200);
  expect(r.body.metadata.auth).toBe("untrusted");
  expect(fake.requests.at(-1)!.headers.authorization).toBeUndefined();
});

test("anything else needs a token, checked before the cluster is contacted", async () => {
  const seen = fake.requests.length;
  expect((await call("/1.0/instances", { host: "c1.clusters.test" })).status).toBe(401);
  expect((await call("/1.0/instances", { host: "c1.clusters.test", token: "garbage" })).status).toBe(401);
  expect(fake.requests.length).toBe(seen);
});

test("callers whose tenant is not on the cluster are refused", async () => {
  const seen = fake.requests.length;
  const r = await call("/1.0/echo", { host: "c1.clusters.test", token: outsider.token });
  expect(r.status).toBe(403);
  expect(r.body.type).toBe("error");
  expect(fake.requests.length).toBe(seen);
});

test("members reach the cluster with their own token and no client certificate", async () => {
  const r = await call("/1.0/echo", { host: "c1.clusters.test", token: member.token });
  expect(r.status).toBe(200);
  expect(r.body.metadata.headers.authorization).toBe(`Bearer ${member.token}`);
  expect(fake.requests.at(-1)!.clientFingerprint).toBe("");
});

test("path routing with a session sends the session's token, never the cookie", async () => {
  const { cookie, accessToken } = await sessionCookie(member.id);
  const r = await call("/clusters/c1/1.0/echo", { cookie });
  expect(r.status).toBe(200);
  expect(r.body.metadata.headers.authorization).toBe(`Bearer ${accessToken}`);
  expect(r.body.metadata.headers.cookie).toBeUndefined();
});

test("host routing ignores session cookies", async () => {
  const { cookie } = await sessionCookie(member.id);
  expect((await call("/1.0/echo", { host: "c1.clusters.test", cookie })).status).toBe(401);
});

test("session changes from another origin are refused", async () => {
  const { cookie } = await sessionCookie(member.id);
  expect((await call("/clusters/c1/1.0/echo", { cookie, method: "POST", origin: "https://evil.test" })).status).toBe(403);
  expect((await call("/clusters/c1/1.0/echo", { cookie, method: "POST", origin: "https://cloud.test" })).status).toBe(200);
});

const upgrade = (path: string, headers: Record<string, string>) =>
  new Promise<string>((resolve) => {
    const s = connect({ host: "127.0.0.1", port, ca, servername: "localhost" }, () => {
      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
      s.write(`GET ${path} HTTP/1.1\r\nhost: cloud.test\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extra}\r\n`);
    });
    let out = "";
    s.on("data", (d) => {
      out += d;
      if (out.includes("\r\n\r\n")) s.destroy();
    });
    s.on("close", () => resolve(out));
    s.on("error", () => resolve(out));
  });

test("cross-site websocket hijacking with the session cookie is refused", async () => {
  const { cookie } = await sessionCookie(member.id);
  expect(await upgrade("/clusters/c1/1.0/ws", { cookie, origin: "https://evil.test" })).toStartWith("HTTP/1.1 403");
  expect(await upgrade("/clusters/c1/1.0/ws", { cookie, origin: "https://cloud.test" })).toStartWith("HTTP/1.1 101");
  expect(await upgrade("/clusters/c1/1.0/ws", { origin: "https://cloud.test" })).toStartWith("HTTP/1.1 401");
});

test("disabled clusters answer 503", async () => {
  await h.db.update(clusters).set({ status: "disabled" }).where(eq(clusters.id, clusterId));
  expect((await call("/1.0/echo", { host: "c1.clusters.test", token: member.token })).status).toBe(503);
});

test("traversal in the path never changes the cluster", async () => {
  expect((await call("/clusters/c1/../c2/1.0", { token: member.token })).status).toBe(404);
});

test("platform API requests are not the gateway's", async () => {
  expect((await call("/healthz")).body).toEqual({ status: "ok" });
});

test("relayed and refused requests are both reported", async () => {
  await call("/1.0/echo", { host: "c1.clusters.test", token: member.token, method: "POST" });
  await call("/1.0/echo", { host: "c1.clusters.test", token: outsider.token, method: "POST" });
  await Bun.sleep(20);
  expect(logged.map((r) => [r.principal?.id, r.status])).toEqual([[member.id, 200], [outsider.id, 403]]);
});
