import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, clusters, instances, jobs, placements, replicationPolicies } from "../db/schema.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let lab: string;
let edge: string;
let acme: { id: string };
let other: { id: string };
let web: string;

beforeEach(async () => {
  h = await harness();
  const mk = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  lab = await mk("lab");
  edge = await mk("edge");
  acme = await h.tenant("acme");
  other = await h.tenant("other");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: acme.id, clusterId: edge, project: "acme", status: "ready" },
  ]);
  web = (await h.db.insert(instances).values({ clusterId: lab, project: "acme", name: "web", type: "container", status: "Running", search: "web" }).returning())[0]!.id;
});

test("a tenant admin creates a policy to the tenant's other placement; viewers can read it, not create one", async () => {
  const ta = await h.user("ta@example.com", { tenants: { [acme.id]: "admin" } });
  const r = await h.call(ta, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge, intervalS: 900 });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ tenantId: acme.id, sourceClusterId: lab, sourceProject: "acme", instanceName: "web", targetClusterId: edge, targetProject: "acme", targetName: "web", intervalS: 900, enabled: true, state: "active" });
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "replication.create"))).length).toBe(1);
  const v = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  expect((await h.call(v, "GET", "/api/v1/replication-policies")).body.map((p: { id: string }) => p.id)).toEqual([r.body.id]);
  expect((await h.call(v, "GET", `/api/v1/replication-policies/${r.body.id}`)).body.targetName).toBe("web");
  expect((await h.call(v, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge })).status).toBe(403);
  // A member (an unrestricted user on the tenant) may: here the instance already has one.
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  expect((await h.call(m, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge })).status).toBe(409);
  const s = await h.user("s@example.com", { tenants: { [other.id]: "admin" } });
  expect((await h.call(s, "GET", "/api/v1/replication-policies")).body).toEqual([]);
  expect((await h.call(s, "GET", `/api/v1/replication-policies/${r.body.id}`)).status).toBe(404);
});

test("validation: interval bounds, the same cluster, a duplicate", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  expect((await h.call(op, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge, intervalS: 30 })).status).toBe(400);
  expect((await h.call(op, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: lab })).status).toBe(400);
  expect((await h.call(op, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge, targetName: "web-dr" })).status).toBe(201);
  expect((await h.call(op, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge })).status).toBe(409);
});

test("edit, run now, fail over and delete; not viewers", async () => {
  const ta = await h.user("ta@example.com", { tenants: { [acme.id]: "admin" } });
  const v = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  const id = (await h.call(ta, "POST", "/api/v1/replication-policies", { instanceId: web, targetClusterId: edge })).body.id;
  expect((await h.call(v, "PATCH", `/api/v1/replication-policies/${id}`, { enabled: false })).status).toBe(403);
  expect((await h.call(ta, "PATCH", `/api/v1/replication-policies/${id}`, { enabled: false, intervalS: 120 })).body).toMatchObject({ enabled: false, intervalS: 120 });

  const run = await h.call(ta, "POST", `/api/v1/replication-policies/${id}/run`);
  expect(run.status).toBe(202);
  expect(run.body).toMatchObject({ type: "replicate", payload: { policyId: id }, tenantId: acme.id });
  expect((await h.call(ta, "POST", `/api/v1/replication-policies/${id}/run`)).status).toBe(409);
  await h.db.update(jobs).set({ state: "succeeded" });

  expect((await h.call(v, "POST", `/api/v1/replication-policies/${id}/failover`, { stopSource: true })).status).toBe(403);
  const fo = await h.call(ta, "POST", `/api/v1/replication-policies/${id}/failover`, { stopSource: true });
  expect(fo.status).toBe(202);
  expect(fo.body).toMatchObject({ type: "failover", payload: { policyId: id, stopSource: true } });
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "replication.failover"))).map((a) => a.result).sort()).toEqual(["denied", "success"]);

  expect((await h.call(v, "DELETE", `/api/v1/replication-policies/${id}`)).status).toBe(403);
  expect((await h.call(ta, "DELETE", `/api/v1/replication-policies/${id}`)).status).toBe(204);
  expect(await h.db.select().from(replicationPolicies)).toEqual([]);
});
