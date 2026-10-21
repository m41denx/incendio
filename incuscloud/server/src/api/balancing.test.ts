import { beforeEach, expect, test } from "bun:test";
import { auditLog, balancingPolicies, clusterMembers, clusters, instances, jobs, placements } from "../db/schema.ts";
import { harness } from "../test/harness.ts";
import { fakeMembers } from "../test/fake-members.ts";

const GiB = 1024 ** 3;
let h: Awaited<ReturnType<typeof harness>>;
let fake: ReturnType<typeof fakeMembers>;
let lab: string;
let edge: string;

beforeEach(async () => {
  const m = (name: string) => ({ name, status: "Online" as const, memoryTotal: 16 * GiB, memoryBase: GiB, cpus: 8 });
  const off = (name: string) => ({ project: "acme", name, type: "container" as const, status: "Stopped" as const, location: "d1", memory: 0, config: { "limits.memory": "4GiB" } });
  fake = fakeMembers([m("d1"), m("d2")], [off("a"), off("b")]);
  h = await harness({ clientOf: () => fake });
  const mk = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  lab = await mk("lab");
  edge = await mk("edge");
  await h.db.insert(clusterMembers).values([
    { clusterId: lab, name: "d1", status: "Online", memoryTotal: 100 * GiB, memoryUsed: 80 * GiB },
    { clusterId: lab, name: "d2", status: "Online", memoryTotal: 100 * GiB, memoryUsed: 80 * GiB },
    { clusterId: edge, name: "e1", status: "Online", memoryTotal: 100 * GiB, memoryUsed: 20 * GiB },
  ]);
});

test("the policy: defaults until set; viewers read, operators write (audited), others neither", async () => {
  const viewer = await h.user("v@example.com", { platformRole: "viewer" });
  const op = await h.user("o@example.com", { platformRole: "operator" });
  const nobody = await h.user("n@example.com");
  let r = await h.call(viewer, "GET", `/api/v1/clusters/${lab}/balancing`);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ clusterId: lab, enabled: false, method: "memory", mode: "used", balanciness: 10, maxMoves: 5, allowRestart: false, excludeMembers: [], excludeProjects: [], lastRunAt: null });
  expect((await h.call(nobody, "GET", `/api/v1/clusters/${lab}/balancing`)).status).toBe(404);
  const body = { enabled: true, method: "cpu", mode: "assigned", balanciness: 15, intervalS: 600, maxMoves: 3, allowRestart: true, excludeMembers: ["d2"], excludeProjects: ["keep"] };
  expect((await h.call(viewer, "PUT", `/api/v1/clusters/${lab}/balancing`, body)).status).toBe(403);
  r = await h.call(op, "PUT", `/api/v1/clusters/${lab}/balancing`, body);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject(body);
  r = await h.call(op, "PUT", `/api/v1/clusters/${lab}/balancing`, { ...body, balanciness: 15, maxMoves: 4 });
  expect((await h.db.select().from(balancingPolicies))[0]!.maxMoves).toBe(4);
  expect((await h.call(op, "PUT", `/api/v1/clusters/${lab}/balancing`, { ...body, balanciness: 0 })).status).toBe(400);
  expect((await h.call(op, "PUT", `/api/v1/clusters/${lab}/balancing`, { ...body, method: "net" })).status).toBe(400);
  expect((await h.call(op, "GET", `/api/v1/clusters/00000000-0000-4000-8000-000000000000/balancing`)).status).toBe(404);
  expect((await h.db.select().from(auditLog)).filter((a) => a.action === "balancing_policy.update")).toHaveLength(2);
});

test("a dry run plans from a fresh read, with unsaved settings if given; nothing moves", async () => {
  const op = await h.user("o@example.com", { platformRole: "operator" });
  const viewer = await h.user("v@example.com", { platformRole: "viewer" });
  expect((await h.call(viewer, "POST", `/api/v1/clusters/${lab}/balancing/plan`, {})).status).toBe(403);
  let r = await h.call(op, "POST", `/api/v1/clusters/${lab}/balancing/plan`, {});
  expect(r.status).toBe(200);
  // Used mode: stopped instances weigh nothing.
  expect(r.body.moves).toEqual([]);
  r = await h.call(op, "POST", `/api/v1/clusters/${lab}/balancing/plan`, { mode: "assigned" });
  expect(r.body.moves).toEqual([{ project: "acme", name: "a", from: "d1", to: "d2", reason: "balance" }]);
  expect(r.body.before).toBeGreaterThan(r.body.after);
  expect(fake.log).toEqual([]);
});

test("run, evacuate and restore are jobs for operators; one rebalance per cluster at a time; unknown members are 404", async () => {
  const op = await h.user("o@example.com", { platformRole: "operator" });
  const viewer = await h.user("v@example.com", { platformRole: "viewer" });
  expect((await h.call(viewer, "POST", `/api/v1/clusters/${lab}/balancing/run`)).status).toBe(403);
  let r = await h.call(op, "POST", `/api/v1/clusters/${lab}/balancing/run`);
  expect(r.status).toBe(202);
  expect(r.body).toMatchObject({ type: "rebalance", payload: { clusterId: lab } });
  expect((await h.call(op, "POST", `/api/v1/clusters/${lab}/balancing/run`)).status).toBe(409);
  expect((await h.call(viewer, "POST", `/api/v1/clusters/${lab}/members/d1/evacuate`, { mode: "migrate" })).status).toBe(403);
  r = await h.call(op, "POST", `/api/v1/clusters/${lab}/members/d1/evacuate`, { mode: "migrate" });
  expect(r.status).toBe(202);
  expect(r.body).toMatchObject({ type: "evacuate", payload: { clusterId: lab, member: "d1", mode: "migrate" } });
  expect((await h.call(op, "POST", `/api/v1/clusters/${lab}/members/d1/evacuate`, { mode: "teleport" })).status).toBe(400);
  expect((await h.call(op, "POST", `/api/v1/clusters/${lab}/members/d9/evacuate`, {})).status).toBe(404);
  // The member's previous job holds it.
  expect((await h.call(op, "POST", `/api/v1/clusters/${lab}/members/d1/restore`)).status).toBe(409);
  r = await h.call(op, "POST", `/api/v1/clusters/${lab}/members/d2/restore`);
  expect(r.body).toMatchObject({ type: "restore-member", payload: { clusterId: lab, member: "d2" } });
  expect((await h.db.select().from(jobs)).length).toBe(3);
  const actions = (await h.db.select().from(auditLog))
    .filter((a) => a.result === "success")
    .map((a) => a.action)
    .sort();
  expect(actions).toEqual(["balancing.run", "cluster_member.evacuate", "cluster_member.restore"]);
});

test("suggestions: staff see every tenant's, tenant members their own, others none", async () => {
  const acme = await h.tenant("acme");
  const beta = await h.tenant("beta");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: acme.id, clusterId: edge, project: "acme-e", status: "ready" },
    { tenantId: beta.id, clusterId: lab, project: "beta", status: "ready" },
    { tenantId: beta.id, clusterId: edge, project: "beta-e", status: "ready" },
  ]);
  const row = (project: string, name: string, gib: number) => ({ clusterId: lab, project, name, type: "container", status: "Running", memoryUsed: gib * GiB, search: name });
  await h.db.insert(instances).values([row("acme", "big", 30), row("beta", "bb", 30)]);
  const viewer = await h.user("v@example.com", { platformRole: "viewer" });
  const member = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const nobody = await h.user("n@example.com");
  let r = await h.call(viewer, "GET", "/api/v1/balancing/suggestions");
  expect(r.status).toBe(200);
  expect(r.body.map((s: { name: string }) => s.name).sort()).toEqual(["bb", "big"]);
  expect(r.body.find((s: { name: string }) => s.name === "big")).toMatchObject({ fromClusterName: "lab", toClusterName: "edge", toProject: "acme-e", tenantSlug: "acme" });
  expect(typeof r.body[0].instanceId).toBe("string");
  r = await h.call(member, "GET", "/api/v1/balancing/suggestions");
  expect(r.body.map((s: { name: string }) => s.name)).toEqual(["big"]);
  r = await h.call(nobody, "GET", "/api/v1/balancing/suggestions");
  expect(r.body).toEqual([]);
});
