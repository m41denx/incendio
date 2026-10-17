import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:https";
import { clusters, placements, sessions } from "../db/schema.ts";
import { createFront } from "../front.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { harness, type Actor } from "../test/harness.ts";
import { ClusterCache } from "../gateway/clusters-cache.ts";
import { Upstreams } from "../gateway/relay.ts";
import { createFacade } from "./handler.ts";
import { fakeIncusApi, type IncusModel } from "./fake-api.ts";

const tls = { cert: readFileSync(new URL("../test/fixtures/test.crt", import.meta.url)), key: readFileSync(new URL("../test/fixtures/test.key", import.meta.url)) };
const ca = tls.cert.toString();
let c1: FakeIncus;
let c2: FakeIncus;
let m1: IncusModel;
let m2: IncusModel;
let h: Awaited<ReturnType<typeof harness>>;
let server: Server;
let port: number;
let admin: Actor;
let alice: Actor; // acme: on c1 and c2
let bob: Actor; // beta: on c1 only

beforeAll(async () => {
  c1 = await new FakeIncus().start();
  c2 = await new FakeIncus().start();
});
afterAll(() => {
  c1.stop();
  c2.stop();
});

beforeEach(async () => {
  server?.close();
  m1 = {
    clustered: true,
    extensions: ["a", "b", "c"],
    members: ["m1", "m2"],
    projects: ["default", "acme", "beta"],
    pools: ["local"],
    instances: [
      { name: "web", project: "acme", location: "m2" },
      { name: "db", project: "acme", location: "m1" },
      { name: "b1", project: "beta", location: "m1" },
    ],
    seen: [],
  };
  m2 = { clustered: false, extensions: ["a", "c"], members: [], projects: ["default", "acme"], pools: ["fast"], instances: [{ name: "web", project: "acme", location: "none" }], seen: [] };
  c1.respond = fakeIncusApi(m1);
  c2.respond = fakeIncusApi(m2);
  h = await harness();
  const ids: Record<string, string> = {};
  for (const [name, fake] of [["c1", c1], ["c2", c2]] as const) {
    const [c] = await h.db.insert(clusters).values({ name, url: fake.url, fingerprint: fake.fingerprint, serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning();
    ids[name] = c!.id;
  }
  const acme = await h.tenant("acme");
  const beta = await h.tenant("beta");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: ids.c1!, project: "acme", status: "ready" },
    { tenantId: acme.id, clusterId: ids.c2!, project: "acme", status: "ready" },
    { tenantId: beta.id, clusterId: ids.c1!, project: "beta", status: "ready" },
  ]);
  admin = await h.user("root@example.com", { platformRole: "admin" });
  alice = await h.user("alice@example.com", { tenants: { [acme.id]: "member" } });
  bob = await h.user("bob@example.com", { tenants: { [beta.id]: "member" } });
  const facade = createFacade({ ...h.deps, clusters: new ClusterCache(h.db, 0), upstreams: new Upstreams(), imageServers: ["https://images.linuxcontainers.org", "https://mirror.example"] });
  server = createFront({ app: h.app, facade, tls });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

async function cookieOf(a: Actor) {
  const id = `sess-${crypto.randomUUID()}`;
  await h.db.insert(sessions).values({ id: createHash("sha256").update(id).digest("hex"), userId: a.id, accessToken: a.token, expiresAt: new Date(Date.now() + 3600e3) });
  return `ic_session=${id}`;
}

const call = async (as: Actor | null, path: string, o: { method?: string; body?: unknown; referer?: string; origin?: string; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { host: "cloud.test", ...o.headers };
  if (as) headers.cookie = await cookieOf(as);
  if (o.referer) headers.referer = o.referer;
  if (o.origin) headers.origin = o.origin;
  else if (o.method && o.method !== "GET") headers.origin = "https://cloud.test";
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`https://127.0.0.1:${port}${path}`, {
    method: o.method ?? "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    tls: { ca, checkServerIdentity: () => undefined },
  } as RequestInit);
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status, body, type: r.headers.get("content-type") ?? "" };
};
const names = (list: Array<{ name: string }>) => list.map((x) => x.name).sort();

test("anonymous callers see an untrusted server and nothing else", async () => {
  const s = await call(null, "/1.0");
  expect(s.status).toBe(200);
  expect(s.body.metadata.auth).toBe("untrusted");
  expect((await call(null, "/1.0/instances?project=acme")).status).toBe(401);
});

test("the server is one federated cluster: extensions every cluster has, no single cluster's config", async () => {
  const s = await call(admin, "/1.0");
  expect(s.body.metadata).toMatchObject({ auth: "trusted", api_extensions: ["a", "c"], environment: { server_clustered: true } });
  // No one cluster's config: only what the console itself sets.
  expect(Object.keys(s.body.metadata.config)).toEqual(["user.ui.image_servers"]);
});

test("Incendio's image picker learns the extra image servers from the server config", async () => {
  const s = await call(alice, "/1.0");
  expect(JSON.parse(s.body.metadata.config["user.ui.image_servers"])).toEqual([{ name: "mirror.example", url: "https://mirror.example" }]);
});

test("on a cluster's page (create instance there), the image picker still learns the extra image servers", async () => {
  const s = await call(alice, "/1.0", { referer: "https://cloud.test/ui/project/acme@c1/instances/create" });
  expect(s.status).toBe(200);
  expect(JSON.parse(s.body.metadata.config["user.ui.image_servers"])).toEqual([{ name: "mirror.example", url: "https://mirror.example" }]);
});

test("projects are never merged: each cluster's, qualified; from a cluster's page, that cluster's", async () => {
  const r = await call(admin, "/1.0/projects?recursion=1");
  expect(names(r.body.metadata)).toEqual(["acme@c1", "acme@c2", "beta@c1", "default@c1", "default@c2"]);
  const fromPage = await call(admin, "/1.0/projects?recursion=1", { referer: "https://cloud.test/ui/project/acme@c1/instances" });
  expect(names(fromPage.body.metadata)).toEqual(["acme@c1", "beta@c1", "default@c1"]);
  // The console's tree asks for every cluster, wherever it is.
  const tree = await call(admin, "/1.0/projects?recursion=1", { referer: "https://cloud.test/inventory/c1", headers: { "x-incuscloud-scope": "all" } });
  expect(names(tree.body.metadata)).toEqual(["acme@c1", "acme@c2", "beta@c1", "default@c1", "default@c2"]);
});

test("always-merged paths are one cluster's on that cluster's console pages", async () => {
  const before = m2.seen.length;
  const r = await call(admin, "/1.0/warnings", { referer: "https://cloud.test/inventory/c1/configure/warnings" });
  expect(r.status).toBe(200);
  expect(m1.seen.at(-1)!.url).toBe("/1.0/warnings");
  expect(m2.seen.slice(before).some((x) => x.url.startsWith("/1.0/warnings"))).toBe(false);
  const scoped = await call(admin, "/1.0/cluster/members", { headers: { "x-incuscloud-scope": "c1" } });
  const memberNames = scoped.body.metadata.map((m: any) => (typeof m === "string" ? decodeURIComponent(m) : m.server_name));
  expect(memberNames.length).toBeGreaterThan(0);
  expect(memberNames.every((m: string) => m.endsWith("@c1"))).toBe(true);
});

test("a standalone cluster's own /1.0 reports clustered, as its synthesized member views do", async () => {
  const r = await call(admin, "/1.0", { referer: "https://cloud.test/inventory/c2" });
  expect(r.status).toBe(200);
  expect(r.body.metadata.environment.server_clustered).toBe(true);
});

test("a merged project lists every cluster's instances, each marked with its project and member", async () => {
  const r = await call(alice, "/1.0/instances?project=acme&recursion=2");
  expect(r.status).toBe(200);
  expect(r.body.metadata.map((i: any) => `${i.name} ${i.project} ${i.location}`).sort()).toEqual(["db acme@c1 m1@c1", "web acme@c1 m2@c1", "web acme@c2 c2@c2"]);
});

test("a cluster that is down leaves the merged list to the others", async () => {
  c2.respond = () => ({ status: 500, body: { type: "error", error_code: 500, error: "down" } });
  const r = await call(alice, "/1.0/instances?project=acme&recursion=2");
  expect(r.status).toBe(200);
  expect(r.body.metadata.map((i: any) => i.project)).toEqual(["acme@c1", "acme@c1"]);
});

test("callers reach only the clusters they have access to", async () => {
  const r = await call(bob, "/1.0/projects?recursion=1");
  expect(r.body.metadata.every((p: any) => p.name.endsWith("@c1"))).toBe(true);
  const other = await call(bob, "/1.0/instances?project=acme%40c2");
  expect(other.status).toBe(403);
  expect(other.body).toMatchObject({ type: "error", error_code: 403 });
});

test("no-access on a cluster drops it from an admin's merged lists", async () => {
  const { aclEntries } = await import("../db/schema.ts");
  await h.db.insert(aclEntries).values({ path: "/clusters/c2", role: "no-access", userId: admin.id });
  const r = await call(admin, "/1.0/storage-pools?recursion=1", { referer: "https://cloud.test/ui/project/acme/storage/pools" });
  expect(names(r.body.metadata)).toEqual(["local@c1"]);
});

test("a global call from a project's page goes to that project's cluster", async () => {
  const r = await call(admin, "/1.0/storage-pools?recursion=1", { referer: "https://cloud.test/ui/project/acme@c2/instances/create" });
  expect(names(r.body.metadata)).toEqual(["fast@c2"]);
  const all = await call(admin, "/1.0/storage-pools?recursion=1", { referer: "https://cloud.test/ui/project/acme/storage/pools" });
  expect(names(all.body.metadata)).toEqual(["fast@c2", "local@c1"]);
  // Another site's page says nothing about the cluster.
  const foreign = await call(admin, "/1.0/storage-pools?recursion=1", { referer: "https://evil.test/ui/project/acme@c2/" });
  expect(foreign.body.metadata).toHaveLength(2);
});

test("a change reaches its cluster without qualifiers, and its operation comes back qualified", async () => {
  const r = await call(alice, "/1.0/instances/web?project=acme%40c1", { method: "PUT", body: { devices: { root: { type: "disk", path: "/", pool: "local@c1" } }, profiles: ["default"] } });
  expect(r.status).toBe(202);
  expect(r.body.operation).toBe("/1.0/operations/op-1@c1");
  expect(r.body.metadata.id).toBe("op-1@c1");
  expect(m1.seen.at(-1)).toEqual({ method: "PUT", url: "/1.0/instances/web?project=acme", body: { devices: { root: { type: "disk", path: "/", pool: "local" } }, profiles: ["default"] } });
  expect(m2.seen.filter((s) => s.method !== "GET")).toEqual([]);
  // Waiting on it goes to the same cluster.
  const w = await call(alice, "/1.0/operations/op-1%40c1/wait?timeout=1");
  expect(w.body.metadata.id).toBe("op-1@c1");
});

test("a change that names no cluster is refused; so are two clusters at once", async () => {
  const r = await call(alice, "/1.0/instances/web?project=acme", { method: "DELETE" });
  expect(r.status).toBe(400);
  expect(r.body.error).toContain("cluster");
  expect([...m1.seen, ...m2.seen].filter((s) => s.method === "DELETE")).toEqual([]);
  expect((await call(alice, "/1.0/instances/web?project=acme%40c1&target=m1%40c2")).status).toBe(400);
});

test("creating an instance in a merged project places it on one of the project's clusters", async () => {
  const r = await call(bob, "/1.0/instances?project=beta", { method: "POST", body: { name: "new", source: { type: "image", alias: "debian/12" } } });
  expect(r.status).toBe(202);
  expect(r.body.operation).toBe("/1.0/operations/op-1@c1");
  expect(m1.seen.at(-1)).toMatchObject({ method: "POST", url: "/1.0/instances?project=beta", body: { name: "new" } });
});

test("members: a standalone server is one member named after its cluster", async () => {
  const r = await call(admin, "/1.0/cluster/members?recursion=1");
  expect(r.body.metadata.map((m: any) => `${m.server_name} ${m.status}`).sort()).toEqual(["c2@c2 Online", "m1@c1 Online", "m2@c1 Online"]);
  const one = await call(admin, "/1.0/cluster/members/c2%40c2");
  expect(one.body.metadata.server_name).toBe("c2@c2");
  // Targeting the standalone member sends no target.
  await call(admin, "/1.0/instances?project=acme%40c2&target=c2%40c2", { method: "POST", body: { name: "x" } });
  expect(m2.seen.at(-1)!.url).toBe("/1.0/instances?project=acme");
});

test("a cluster whose /1.0 says nothing about it (untrusted, an error) is not taken for a standalone server, nor remembered", async () => {
  const members = async () => (await call(admin, "/1.0/cluster/members?recursion=1")).body.metadata.map((m: any) => m.server_name).sort();
  for (const answer of ["untrusted", "error"] as const) {
    m1.server = answer;
    expect(await members()).not.toContain("c1@c1");
    m1.server = undefined;
    expect(await members()).toEqual(["c2@c2", "m1@c1", "m2@c1"]);
  }
});

test("non-JSON bodies pass through untouched", async () => {
  const r = await call(alice, "/1.0/instances/web/files?project=acme%40c1&path=%2Fetc%2Fhostname");
  expect(r.type).toBe("application/octet-stream");
  expect(r.body).toBe("web@c1 is not rewritten\n");
});

test("session changes from another origin are refused", async () => {
  const r = await call(alice, "/1.0/instances/web?project=acme%40c1", { method: "DELETE", origin: "https://evil.test" });
  expect(r.status).toBe(403);
  expect(m1.seen.filter((s) => s.method === "DELETE")).toEqual([]);
});

const socket = async (as: Actor, path: string, origin = "https://cloud.test") => {
  const ws = new WebSocket(`wss://127.0.0.1:${port}${path}`, { headers: { cookie: await cookieOf(as), origin }, tls: { rejectUnauthorized: false } } as never);
  const got: string[] = [];
  ws.onmessage = (e) => got.push(String(e.data));
  const opened = await new Promise<boolean>((r) => {
    ws.onopen = () => r(true);
    ws.onerror = () => r(false);
    ws.onclose = () => r(false);
  });
  return { ws, got, opened };
};
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("events: one stream from every reachable cluster, each event marked with its cluster", async () => {
  const s = await socket(alice, "/1.0/events?type=operation,lifecycle&all-projects=true");
  expect(s.opened).toBe(true);
  await until(() => c1.eventSockets.length === 1 && c2.eventSockets.length === 1);
  const up = c1.upgrades.findLast((u) => u.url.startsWith("/1.0/events"))!;
  expect(up.url).toBe("/1.0/events?type=operation,lifecycle&all-projects=true");
  expect(up.headers.authorization).toBe(`Bearer ${alice.token}`);
  c1.emit({ type: "operation", project: "acme", location: "m1", metadata: { id: "op-7", status: "Success", resources: { instances: ["/1.0/instances/web?project=acme"] } } });
  c2.emit({ type: "lifecycle", project: "acme", location: "none", metadata: { action: "instance-started", source: "/1.0/instances/web?project=acme" } });
  await until(() => s.got.length === 2);
  const events = s.got.map((x) => JSON.parse(x));
  expect(events).toContainEqual({ type: "operation", project: "acme@c1", location: "m1@c1", metadata: { id: "op-7@c1", status: "Success", resources: { instances: ["/1.0/instances/web?project=acme@c1"] } } });
  expect(events).toContainEqual({ type: "lifecycle", project: "acme@c2", location: "c2@c2", metadata: { action: "instance-started", source: "/1.0/instances/web?project=acme@c2" } });
  s.ws.close();
  await until(() => c1.eventSockets.length === 0 && c2.eventSockets.length === 0);
});

test("events reach only the clusters the caller may use; other sites cannot open them", async () => {
  const s = await socket(bob, "/1.0/events?type=operation");
  await until(() => c1.eventSockets.length === 1);
  expect(c2.eventSockets).toHaveLength(0);
  s.ws.close();
  expect((await socket(bob, "/1.0/events?type=operation", "https://evil.test")).opened).toBe(false);
});

test("an operation's websocket goes to its cluster", async () => {
  c1.operationSockets.set("op-9", "s3");
  const s = await socket(alice, "/1.0/operations/op-9%40c1/websocket?secret=s3");
  expect(s.opened).toBe(true);
  s.ws.send("ping");
  await until(() => s.got.length === 1);
  expect(s.got).toEqual(["ping"]);
  s.ws.close();
});
