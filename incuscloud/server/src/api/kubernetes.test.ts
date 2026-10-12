import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { auditLog, clusters, jobs, k8sClusters, placements, tenants } from "../db/schema.ts";
import { harness } from "../test/harness.ts";
import { FakeKube } from "../k8s/fake-kube.ts";

const GiB = 1024 ** 3;
let h: Awaited<ReturnType<typeof harness>>;
let kube: FakeKube;
let acme: { id: string };
let lab: string;

beforeEach(async () => {
  kube = new FakeKube();
  h = await harness({ kube, k8sPorts: [16443, 16445] });
  lab = (await h.db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  acme = await h.tenant("acme");
  await h.db.update(tenants).set({ quotas: { instances: 6 } }).where(eq(tenants.id, acme.id));
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: lab, project: "acme", status: "ready", usage: { instances: 0, cpu: 0, memory: 0, disk: 0 } });
});

const make = (o: Record<string, unknown> = {}) => ({ tenantId: acme.id, clusterId: lab, name: "web", version: "v1.36.4", controlPlanes: 1, workers: 1, size: "small", ...o });
const member = () => h.user("m@example.com", { tenants: { [acme.id]: "member" } });
const rows = () => h.db.select().from(k8sClusters).orderBy(k8sClusters.name);

test("without a management cluster: versions say so, everything else is 409 kubernetes_disabled", async () => {
  const off = await harness();
  const u = await off.user("op@example.com", { platformRole: "operator" });
  expect((await off.call(u, "GET", "/api/v1/kubernetes/versions")).body).toMatchObject({ enabled: false });
  const r = await off.call(u, "GET", "/api/v1/kubernetes");
  expect(r.status).toBe(409);
  expect(r.body.error.code).toBe("kubernetes_disabled");
  const anyone = await h.user("x@example.com");
  const v = await h.call(anyone, "GET", "/api/v1/kubernetes/versions");
  expect(v.body).toEqual({ enabled: true, versions: ["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"], sizes: { small: { cpu: 2, memoryGiB: 2 }, medium: { cpu: 2, memoryGiB: 4 }, large: { cpu: 4, memoryGiB: 8 } } });
});

test("create: a member gets a cluster on the cluster's address and the first port, and a job carrying its usage", async () => {
  const m = await member();
  const r = await h.call(m, "POST", "/api/v1/kubernetes", make());
  expect(r.status).toBe(202);
  expect(r.body.cluster).toMatchObject({ name: "web", tenantSlug: "acme", clusterName: "lab", status: "creating", endpoint: "https://10.0.0.5:16443", nodes: 0, nodesReady: 0 });
  expect(r.body.job.type).toBe("k8s-create");
  const [row] = await rows();
  expect(row).toMatchObject({ namespace: "ic-acme", endpointHost: "10.0.0.5", endpointPort: 16443, lbMember: "", createdBy: m.id });
  const [job] = await h.db.select().from(jobs);
  expect(job!.payload).toEqual({ k8sId: row!.id, name: "web", clusterId: lab, usage: { instances: 3, cpu: 5, memory: 5 * GiB, disk: 30 * GiB } });
  const [a] = await h.db.select().from(auditLog).where(eq(auditLog.action, "kubernetes.create"));
  expect(a).toMatchObject({ result: "success" });
});

test("create is refused: viewers, unplaced or not-ready tenants, names taken, bad input", async () => {
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  expect((await h.call(viewer, "POST", "/api/v1/kubernetes", make())).status).toBe(403);
  const outsider = await h.user("o@example.com");
  expect((await h.call(outsider, "POST", "/api/v1/kubernetes", make())).status).toBe(404);
  const m = await member();
  const edge = (await h.db.insert(clusters).values({ name: "edge", url: "https://10.0.0.6:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  let r = await h.call(m, "POST", "/api/v1/kubernetes", make({ clusterId: edge }));
  expect([r.status, r.body.error.message]).toEqual([409, "The tenant is not placed on that cluster"]);
  await h.db.update(placements).set({ status: "pending" }).where(eq(placements.clusterId, lab));
  r = await h.call(m, "POST", "/api/v1/kubernetes", make());
  expect([r.status, r.body.error.message]).toEqual([409, "The tenant's project on lab is not ready yet"]);
  await h.db.update(placements).set({ status: "ready" }).where(eq(placements.clusterId, lab));
  expect((await h.call(m, "POST", "/api/v1/kubernetes", make())).status).toBe(202);
  r = await h.call(m, "POST", "/api/v1/kubernetes", make());
  expect([r.status, r.body.error.message]).toEqual([409, 'A Kubernetes cluster named "web" already exists in acme']);
  for (const bad of [{ name: "Web" }, { name: "a".repeat(33) }, { version: "v1.33.0" }, { controlPlanes: 2 }, { workers: 21 }, { size: "huge" }])
    expect((await h.call(m, "POST", "/api/v1/kubernetes", make({ name: "x", ...bad }))).status).toBe(400);
});

test("create: over the quota is refused, counting creates still running; concurrent creates get different ports", async () => {
  const m = await member();
  // 6 instances: each small 1+1 cluster takes 3 (with its load balancer).
  const both = await Promise.all(["a", "b"].map((n) => h.call(m, "POST", "/api/v1/kubernetes", make({ name: n }))));
  expect(both.map((x) => x.status)).toEqual([202, 202]);
  expect((await rows()).map((x) => x.endpointPort).sort()).toEqual([16443, 16444]);
  const r = await h.call(m, "POST", "/api/v1/kubernetes", make({ name: "c", workers: 0 }));
  expect([r.status, r.body.error.message]).toEqual([409, "Over the tenant's quota: instances: 8 of 6"]);
});

test("the port range running out is refused", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const m = await member();
  for (const n of ["a", "b", "c"]) expect((await h.call(m, "POST", "/api/v1/kubernetes", make({ name: n }))).status).toBe(202);
  const r = await h.call(m, "POST", "/api/v1/kubernetes", make({ name: "d" }));
  expect([r.status, r.body.error.message]).toEqual([409, "No free port for a Kubernetes API endpoint on 10.0.0.5 (16443-16445)"]);
});

test("list and get show only the caller's tenants' clusters", async () => {
  const m = await member();
  const { body } = await h.call(m, "POST", "/api/v1/kubernetes", make());
  const other = await h.tenant("other");
  const stranger = await h.user("s@example.com", { tenants: { [other.id]: "owner" } });
  expect((await h.call(m, "GET", "/api/v1/kubernetes")).body.map((c: { name: string }) => c.name)).toEqual(["web"]);
  expect((await h.call(m, "GET", `/api/v1/kubernetes?tenant=${acme.id}`)).body).toHaveLength(1);
  expect((await h.call(stranger, "GET", "/api/v1/kubernetes")).body).toEqual([]);
  expect((await h.call(stranger, "GET", `/api/v1/kubernetes/${body.cluster.id}`)).status).toBe(404);
  expect((await h.call(m, "GET", `/api/v1/kubernetes/${body.cluster.id}`)).body).toMatchObject({ id: body.cluster.id, version: "v1.36.4" });
});

async function readyCluster(o: { workers?: number } = {}) {
  const m = await member();
  const { body } = await h.call(m, "POST", "/api/v1/kubernetes", make(o));
  await h.db.update(k8sClusters).set({ status: "ready" }).where(eq(k8sClusters.id, body.cluster.id));
  await h.db.delete(jobs);
  return { m, id: body.cluster.id as string };
}
const appliedCluster = () => kube.applied.filter((o) => o.kind === "Cluster").at(-1) as unknown as { spec: { topology: { version: string; controlPlane: { replicas: number }; workers: { machineDeployments: Array<{ replicas: number }> } } } };

test("scale: applies the new replicas; up is checked against the quota, down always works", async () => {
  const { m, id } = await readyCluster();
  // 3 used of 6 by this cluster (recorded by the reconciler).
  await h.db.update(placements).set({ usage: { instances: 3, cpu: 5, memory: 5 * GiB, disk: 30 * GiB } });
  let r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 4 });
  expect(r.status).toBe(200);
  expect(appliedCluster().spec.topology.workers.machineDeployments[0]!.replicas).toBe(4);
  expect(r.body.workers).toBe(4);
  await h.db.update(placements).set({ usage: { instances: 6, cpu: 11, memory: 11 * GiB, disk: 60 * GiB } });
  r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 5 });
  expect([r.status, r.body.error.message]).toEqual([409, "Over the tenant's quota: instances: 7 of 6"]);
  r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { controlPlanes: 3 });
  expect([r.status, r.body.error.message]).toEqual([409, "Over the tenant's quota: instances: 8 of 6"]);
  r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 0 });
  expect(r.status).toBe(200);
  expect(appliedCluster().spec.topology.workers.machineDeployments[0]!.replicas).toBe(0);
  expect((await h.db.select().from(auditLog).where(and(eq(auditLog.action, "kubernetes.scale"), eq(auditLog.result, "success")))).length).toBe(2);
});

test("upgrade: one minor version forward to an offered version; not while a job owns the cluster", async () => {
  const { m, id } = await readyCluster();
  let r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { version: "v1.34.0" });
  expect([r.status, r.body.error.code]).toEqual([409, "bad_upgrade"]);
  r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { version: "v1.37.0" });
  expect(r.status).toBe(200);
  expect(appliedCluster().spec.topology.version).toBe("v1.37.0");
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "kubernetes.upgrade")).orderBy(auditLog.id)).map((a) => a.result)).toEqual(["failure", "success"]);
  await h.db.update(k8sClusters).set({ status: "provisioning" });
  r = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 2 });
  expect([r.status, r.body.error.message]).toEqual([409, "web is being created or deleted; try again when it is ready"]);
});

test("delete: tenant admins and operators; marks it deleting, cancels its create, queues one delete job", async () => {
  const m = await member();
  const { body } = await h.call(m, "POST", "/api/v1/kubernetes", make());
  const id = body.cluster.id as string;
  expect((await h.call(m, "DELETE", `/api/v1/kubernetes/${id}`)).status).toBe(403);
  await h.db.update(jobs).set({ state: "running" });
  const admin = await h.user("a@example.com", { tenants: { [acme.id]: "admin" } });
  const r = await h.call(admin, "DELETE", `/api/v1/kubernetes/${id}`);
  expect(r.status).toBe(202);
  expect(r.body.type).toBe("k8s-delete");
  expect(r.body.payload).toEqual({ k8sId: id, name: "web", clusterId: lab });
  expect((await rows())[0]).toMatchObject({ status: "deleting" });
  expect((await h.db.select().from(jobs).where(eq(jobs.type, "k8s-create")))[0]).toMatchObject({ cancelRequested: true });
  const again = await h.call(admin, "DELETE", `/api/v1/kubernetes/${id}`);
  expect([again.status, again.body.error.message]).toEqual([409, "web is already being deleted"]);
  // A failed delete can be retried.
  await h.db.update(jobs).set({ state: "failed" }).where(eq(jobs.type, "k8s-delete"));
  expect((await h.call(admin, "DELETE", `/api/v1/kubernetes/${id}`)).status).toBe(202);
});

test("kubeconfig: members download it from CAPI's secret, audited; 409 until it exists", async () => {
  const { m, id } = await readyCluster();
  const get = () => h.app.handle(new Request(`https://cloud.test/api/v1/kubernetes/${id}/kubeconfig`, { headers: { authorization: `Bearer ${m.token}` } }));
  expect((await get()).status).toBe(409);
  kube.put({ apiVersion: "v1", kind: "Secret", metadata: { name: "web-kubeconfig", namespace: "ic-acme" }, data: { value: Buffer.from("apiVersion: v1\nkind: Config\n").toString("base64") } });
  const r = await get();
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("apiVersion: v1\nkind: Config\n");
  expect(r.headers.get("content-disposition")).toBe('attachment; filename="web.kubeconfig"');
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "kubernetes.kubeconfig"))).map((a) => a.result)).toEqual(["failure", "success"]);
});

test("a tenant with Kubernetes clusters on a cluster is not removed from it, nor the cluster deleted", async () => {
  await readyCluster();
  const op = await h.user("op@example.com", { platformRole: "admin" });
  let r = await h.call(op, "DELETE", `/api/v1/clusters/${lab}/tenants/${acme.id}`);
  expect([r.status, r.body.error.message]).toEqual([409, "acme has 1 Kubernetes cluster(s) on this cluster; delete them first"]);
  r = await h.call(op, "DELETE", `/api/v1/clusters/${lab}?force=true`);
  expect([r.status, r.body.error.message]).toEqual([409, "1 Kubernetes cluster(s) run on this cluster; delete them first"]);
});
