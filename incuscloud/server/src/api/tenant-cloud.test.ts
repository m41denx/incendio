import { beforeEach, expect, test } from "bun:test";
import { auditLog, clusterMembers, clusters, instances, jobs, placements, tenants } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { harness } from "../test/harness.ts";

const GiB = 1024 ** 3;
let h: Awaited<ReturnType<typeof harness>>;
let acme: { id: string };
let lab: string;
let edge: string;

beforeEach(async () => {
  h = await harness();
  const mk = async (name: string, labels: Record<string, string> = {}) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready", labels }).returning())[0]!.id;
  lab = await mk("lab", { region: "eu" });
  edge = await mk("edge", { region: "us" });
  acme = await h.tenant("acme");
  await h.db.update(tenants).set({ quotas: { instances: 5, memory: 8 } }).where(eq(tenants.id, acme.id));
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready", usage: { instances: 1, cpu: 1, memory: GiB, disk: 10 * GiB }, limits: { instances: 3, memory: 5 * GiB } },
    { tenantId: acme.id, clusterId: edge, project: "acme-e", status: "ready", usage: { instances: 1, cpu: 2, memory: 2 * GiB, disk: 0 }, limits: { instances: 4, memory: 7 * GiB } },
  ]);
});

test("usage: the quota, the total and each cluster's share; tenant viewers and platform viewers, nobody else", async () => {
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  const staff = await h.user("s@example.com", { platformRole: "viewer" });
  const other = await h.user("o@example.com");
  const r = await h.call(viewer, "GET", `/api/v1/tenants/${acme.id}/usage`);
  expect(r.status).toBe(200);
  expect(r.body.quota).toEqual({ instances: 5, memory: 8 });
  expect(r.body.used).toEqual({ instances: 2, cpu: 3, memory: 3 * GiB, disk: 10 * GiB });
  expect(r.body.clusters).toEqual([
    { clusterId: edge, clusterName: "edge", project: "acme-e", status: "ready", usage: { instances: 1, cpu: 2, memory: 2 * GiB, disk: 0 }, limits: { instances: 4, memory: 7 * GiB } },
    { clusterId: lab, clusterName: "lab", project: "acme", status: "ready", usage: { instances: 1, cpu: 1, memory: GiB, disk: 10 * GiB }, limits: { instances: 3, memory: 5 * GiB } },
  ]);
  expect((await h.call(staff, "GET", `/api/v1/tenants/${acme.id}/usage`)).status).toBe(200);
  expect((await h.call(other, "GET", `/api/v1/tenants/${acme.id}/usage`)).status).toBe(404);
  expect((await h.call(staff, "GET", "/api/v1/tenants/not-a-uuid/usage")).status).toBe(404);
});

const make = { name: "web", image: "debian/12", cpu: 1, memoryGiB: 1, diskGiB: 8 };
async function withMembers() {
  await h.db.insert(clusterMembers).values([
    { clusterId: lab, name: "l1", status: "Online", memoryTotal: 32 * GiB, memoryUsed: 8 * GiB },
    { clusterId: edge, name: "e1", status: "Online", memoryTotal: 32 * GiB, memoryUsed: 30 * GiB },
  ]);
}

test("create: members and up (and platform operators) start a job on the cluster placement picks; viewers and outsiders cannot", async () => {
  await withMembers();
  const member = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  const op = await h.user("op@example.com", { platformRole: "operator" });
  const other = await h.user("o@example.com");
  expect((await h.call(viewer, "POST", `/api/v1/tenants/${acme.id}/instances`, make)).status).toBe(403);
  expect((await h.call(other, "POST", `/api/v1/tenants/${acme.id}/instances`, make)).status).toBe(404);
  const r = await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, make);
  expect(r.status).toBe(202);
  expect(r.body).toMatchObject({
    type: "create",
    tenantId: acme.id,
    payload: { tenantId: acme.id, clusterId: lab, project: "acme", name: "web", image: "debian/12", type: "container", cpu: 1, memory: GiB, disk: 8 * GiB, start: true },
  });
  expect((await h.call(op, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, name: "web2", clusterId: edge })).body).toMatchObject({ payload: { clusterId: edge, project: "acme-e" } });
  expect((await h.db.select().from(auditLog)).filter((a) => a.action === "instance.create" && a.result === "success")).toHaveLength(2);
});

test("create: a label selector, and placement failures as 409 with the reason", async () => {
  await withMembers();
  const member = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const r = await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, labels: { region: "us" } });
  expect(r.body.payload.clusterId).toBe(edge);
  const none = await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, name: "x", labels: { region: "ap" } });
  expect(none.status).toBe(409);
  expect(none.body.error.message).toBe("No cluster of the tenant has region=ap");
});

test("create: over the quota across clusters is refused, counting creates still running", async () => {
  await withMembers();
  const member = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  // Used: 3 GiB of 8. Two creates of 3 GiB each: the first fits, the second would make 9.
  expect((await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, name: "a", memoryGiB: 3 })).status).toBe(202);
  const r = await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, name: "b", memoryGiB: 3 });
  expect(r.status).toBe(409);
  expect(r.body.error.message).toBe("Over the tenant's quota: memory: 9.0 of 8 GiB");
  // Concurrent requests: exactly one of two that fit only alone gets through.
  await h.db.delete(jobs);
  const both = await Promise.all(["c", "d"].map((n) => h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, name: n, memoryGiB: 4 })));
  expect(both.map((x) => x.status).sort()).toEqual([202, 409]);
});

test("create: a name the inventory already knows in that project is refused; bad input is 400", async () => {
  await withMembers();
  const member = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  await h.db.insert(instances).values({ clusterId: lab, project: "acme", name: "web", type: "container", status: "Running", search: "web" });
  const r = await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, make);
  expect(r.status).toBe(409);
  expect(r.body.error.message).toBe('An instance named "web" already exists in acme on lab');
  for (const bad of [{ ...make, name: "-x" }, { ...make, cpu: 0 }, { ...make, memoryGiB: 0 }, { ...make, image: "../etc" }, { ...make, type: "vmware" }])
    expect((await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, bad)).status).toBe(400);
});

test("images: a short list to choose from, for anyone signed in", async () => {
  const u = await h.user("u@example.com");
  const r = await h.call(u, "GET", "/api/v1/images");
  expect(r.status).toBe(200);
  expect(r.body.length).toBeGreaterThan(3);
  expect(r.body[0]).toEqual({ alias: expect.any(String), label: expect.any(String), vm: expect.any(Boolean) });
  expect((await h.call(null, "GET", "/api/v1/images")).status).toBe(401);
});

test("create: a pending Kubernetes create counts against the quota through its payload's usage", async () => {
  await withMembers();
  const member = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const { enqueueJob } = await import("../jobs/queue.ts");
  // Used: 3 GiB of 8; the Kubernetes cluster being created takes 4 more.
  await enqueueJob(h.db, {
    type: "k8s-create",
    payload: { k8sId: "00000000-0000-4000-8000-000000000008", usage: { instances: 2, cpu: 3, memory: 4 * GiB, disk: 20 * GiB } },
    actor: { type: "user", id: member.id },
    tenantId: acme.id,
    clusterIds: [lab],
  });
  const r = await h.call(member, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...make, name: "a", memoryGiB: 2 });
  expect(r.status).toBe(409);
  expect(r.body.error.message).toBe("Over the tenant's quota: memory: 9.0 of 8 GiB");
});
