import { beforeEach, expect, test } from "bun:test";
import { clusters, gatewayRequests, serviceAccounts } from "../db/schema.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let clusterId: string;
beforeEach(async () => {
  h = await harness();
  clusterId = (await h.db.insert(clusters).values({ name: "c1", url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
});

const row = (actorId: string, path: string, cluster: string | null = clusterId) => ({ clusterId: cluster, actorType: "user", actorId, method: "POST", path, status: 200, bytesIn: 1, bytesOut: 2, durationMs: 3 });

test("platform viewers read everything, newest first, with filters", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  await h.db.insert(gatewayRequests).values([row("a", "/1"), row("b", "/2"), row("a", "/3", null)]);
  const all = await h.call(v, "GET", "/api/v1/gateway-requests");
  expect(all.body.map((r: { path: string }) => r.path)).toEqual(["/3", "/2", "/1"]);
  expect((await h.call(v, "GET", `/api/v1/gateway-requests?cluster=${clusterId}`)).body.length).toBe(2);
  expect((await h.call(v, "GET", "/api/v1/gateway-requests?actor=a&limit=1")).body.map((r: { path: string }) => r.path)).toEqual(["/3"]);
});

test("tenant admins see their members' and service accounts' requests only", async () => {
  const t = await h.tenant("acme");
  const other = await h.tenant("other");
  const ta = await h.user("ta@example.com", { tenants: { [t.id]: "admin" } });
  const m = await h.user("m@example.com", { tenants: { [t.id]: "member" } });
  const stranger = await h.user("s@example.com", { tenants: { [other.id]: "member" } });
  const [sa] = await h.db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-x", tenantId: t.id }).returning();
  await h.db.insert(gatewayRequests).values([row(m.id, "/member"), row(sa!.id, "/sa"), row(stranger.id, "/stranger")]);
  expect((await h.call(ta, "GET", "/api/v1/gateway-requests")).status).toBe(403);
  const r = await h.call(ta, "GET", `/api/v1/gateway-requests?tenant=${t.id}`);
  expect(r.body.map((x: { path: string }) => x.path).sort()).toEqual(["/member", "/sa"]);
  expect((await h.call(ta, "GET", `/api/v1/gateway-requests?tenant=${other.id}`)).status).toBe(403);
});
