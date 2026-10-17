import { beforeEach, expect, test } from "bun:test";
import { aclEntries, clusterMembers, clusters } from "../db/schema.ts";
import { harness, type Actor } from "../test/harness.ts";
import { fakeMembers } from "../test/fake-members.ts";

// Permissions phase 1: entries on one cluster's path act on that cluster only.
const GiB = 1024 ** 3;
let h: Awaited<ReturnType<typeof harness>>;
let c: string;
let d: string;

beforeEach(async () => {
  const m = (name: string) => ({ name, status: "Online" as const, memoryTotal: 16 * GiB, memoryBase: GiB, cpus: 8 });
  h = await harness({ clientOf: () => fakeMembers([m("c1"), m("c2")], []) });
  const mk = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  c = await mk("c");
  d = await mk("d");
  await h.db.insert(clusterMembers).values([
    { clusterId: c, name: "c1", status: "Online", memoryTotal: 16 * GiB, memoryUsed: GiB },
    { clusterId: d, name: "d1", status: "Online", memoryTotal: 16 * GiB, memoryUsed: GiB },
  ]);
});

const grant = async (a: Actor, path: string, role: string) => h.db.insert(aclEntries).values({ path, role, userId: a.id });
const policy = { enabled: false, method: "memory", mode: "used", balanciness: 10, intervalS: 600, maxMoves: 5, allowRestart: false, excludeMembers: [], excludeProjects: [] };

test("an operator of /clusters/c only reconciles and balances c, and gets 404 on d", async () => {
  const op = await h.user("op@x.test");
  await grant(op, "/clusters/c", "operator");
  expect((await h.call(op, "POST", `/api/v1/clusters/${c}/reconcile`)).status).toBe(202);
  expect((await h.call(op, "PUT", `/api/v1/clusters/${c}/balancing`, policy)).status).toBe(200);
  expect((await h.call(op, "POST", `/api/v1/clusters/${d}/reconcile`)).status).toBe(404);
  expect((await h.call(op, "PUT", `/api/v1/clusters/${d}/balancing`, policy)).status).toBe(404);
  expect((await h.call(op, "GET", "/api/v1/clusters")).body.map((x: { name: string }) => x.name)).toEqual(["c"]);
  // Not a platform operator: enrolment and deletion stay platform settings.
  expect((await h.call(op, "DELETE", `/api/v1/clusters/${c}`)).status).toBe(403);
});

test("an auditor of /clusters/c reads c's inventory and nothing of d", async () => {
  const a = await h.user("a@x.test");
  await grant(a, "/clusters/c", "auditor");
  const r = await h.call(a, "GET", `/api/v1/clusters/${c}/inventory`);
  expect([r.status, r.body.members.map((m: { name: string }) => m.name)]).toEqual([200, ["c1"]]);
  expect((await h.call(a, "GET", `/api/v1/clusters/${c}/balancing`)).status).toBe(200);
  expect((await h.call(a, "PUT", `/api/v1/clusters/${c}/balancing`, policy)).status).toBe(403);
  expect((await h.call(a, "GET", `/api/v1/clusters/${d}/inventory`)).status).toBe(404);
  expect((await h.call(a, "GET", `/api/v1/clusters/${d}`)).status).toBe(404);
});

test("no-access on /clusters/c hides c from a platform operator", async () => {
  const op = await h.user("po@x.test", { platformRole: "operator" });
  await grant(op, "/clusters/c", "no-access");
  expect((await h.call(op, "GET", "/api/v1/clusters")).body.map((x: { name: string }) => x.name)).toEqual(["d"]);
  expect((await h.call(op, "GET", `/api/v1/clusters/${c}`)).status).toBe(404);
  expect((await h.call(op, "POST", `/api/v1/clusters/${c}/reconcile`)).status).toBe(404);
  expect((await h.call(op, "POST", `/api/v1/clusters/${d}/reconcile`)).status).toBe(202);
});

test("a cluster owner of c evacuates a member of c, not of d", async () => {
  const o = await h.user("o@x.test");
  await grant(o, "/clusters/c", "cluster-owner");
  expect((await h.call(o, "POST", `/api/v1/clusters/${c}/members/c1/evacuate`, {})).status).toBe(202);
  expect((await h.call(o, "POST", `/api/v1/clusters/${d}/members/d1/evacuate`, {})).status).toBe(404);
  // An unrestricted user of c runs workloads there but does not maintain members.
  const u = await h.user("u@x.test");
  await grant(u, "/clusters/c", "unrestricted-user");
  expect((await h.call(u, "POST", `/api/v1/clusters/${c}/members/c1/restore`)).status).toBe(403);
});
