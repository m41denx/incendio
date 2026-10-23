import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { aclEntries, auditLog, clusters, jobs, k8sClusters, placements, tenants } from "../db/schema.ts";
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
  expect(v.body).toMatchObject({ enabled: true, versions: ["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"], sizes: { small: { cpu: 2, memoryGiB: 2 }, medium: { cpu: 2, memoryGiB: 4 }, large: { cpu: 4, memoryGiB: 8 } } });
  // The create form starts from a medium cluster's spec.
  expect(v.body.defaults).toMatchObject({ controlPlane: { flavor: "c2-m4" }, loadBalancer: { type: "lxc" }, podCidr: "10.244.0.0/16" });
});

test("create: a member gets a cluster on the cluster's address and the first port, and a job carrying its usage", async () => {
  const m = await member();
  const r = await h.call(m, "POST", "/api/v1/kubernetes", make());
  expect(r.status).toBe(202);
  expect(r.body.cluster).toMatchObject({ name: "web", tenantSlug: "acme", clusterName: "lab", project: "acme", status: "creating", endpoint: "https://10.0.0.5:16443", nodes: 0, nodesReady: 0 });
  expect(r.body.job.type).toBe("k8s-create");
  const [row] = await rows();
  expect(row).toMatchObject({ namespace: "ic-acme", endpointHost: "10.0.0.5", endpointPort: 16443, lbMember: "", createdBy: `user:${m.id}` });
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

test("operators create on any ready cluster: the tenant is placed there first, and the job waits for its project", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  const edge = (await h.db.insert(clusters).values({ name: "edge", url: "https://10.0.0.6:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  const r = await h.call(op, "POST", "/api/v1/kubernetes", make({ clusterId: edge }));
  expect(r.status).toBe(202);
  const [placed] = await h.db.select().from(placements).where(and(eq(placements.tenantId, acme.id), eq(placements.clusterId, edge)));
  expect(placed).toMatchObject({ project: "acme", status: "pending" });
  const [c] = await h.db.select({ generation: clusters.reconcileGeneration }).from(clusters).where(eq(clusters.id, edge));
  expect(c!.generation).toBeGreaterThan(0);
  // A cluster that is not ready is still refused.
  const down = (await h.db.insert(clusters).values({ name: "down", url: "https://10.0.0.7:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "error" }).returning())[0]!.id;
  const refused = await h.call(op, "POST", "/api/v1/kubernetes", make({ name: "other", clusterId: down }));
  expect([refused.status, refused.body.error.code]).toEqual([409, "cluster_not_ready"]);
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

test("delete: tenant admins, members and operators, not viewers; marks it deleting, cancels its create, queues one delete job", async () => {
  const m = await member();
  const { body } = await h.call(m, "POST", "/api/v1/kubernetes", make());
  const id = body.cluster.id as string;
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  expect((await h.call(viewer, "DELETE", `/api/v1/kubernetes/${id}`)).status).toBe(403);
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

test("on a multi-member Incus cluster, a create is pinned to the member asked for, or chosen", async () => {
  const { clusterMembers } = await import("../db/schema.ts");
  await h.db.insert(clusterMembers).values([
    { clusterId: lab, name: "m1", url: "https://10.0.0.6:8443", status: "Online" },
    { clusterId: lab, name: "m2", url: "https://10.0.0.7:8443", status: "Online" },
  ]);
  const as = await member();
  let r = await h.call(as, "POST", "/api/v1/kubernetes", { ...make(), name: "third", member: "m9" });
  expect([r.status, r.body.error.code]).toEqual([409, "bad_member"]);
  r = await h.call(as, "POST", "/api/v1/kubernetes", { ...make(), member: "m2" });
  expect(r.status).toBe(202);
  expect(r.body.cluster).toMatchObject({ member: "m2", endpoint: "https://10.0.0.7:16443" });
  r = await h.call(as, "POST", "/api/v1/kubernetes", { ...make(), name: "other" });
  expect(r.status).toBe(202);
  expect(["m1", "m2"]).toContain(r.body.cluster.member);
});

const machine = (name: string, o: { cp?: boolean; phase?: string; ready?: boolean; cluster?: string; version?: string } = {}) => ({
  apiVersion: "cluster.x-k8s.io/v1beta2",
  kind: "Machine",
  metadata: { name, namespace: "ic-acme", labels: { "cluster.x-k8s.io/cluster-name": o.cluster ?? "web", ...(o.cp ? { "cluster.x-k8s.io/control-plane": "" } : {}) } },
  spec: { version: o.version ?? "v1.36.4", infrastructureRef: { apiGroup: "infrastructure.cluster.x-k8s.io", kind: "LXCMachine", name: `${name}-lxc` } },
  status: { phase: o.phase ?? "Running", conditions: [{ type: "Ready", status: o.ready === false ? "False" : "True" }] },
});

test("a cluster's nodes: its Machines, control plane first, each with its Incus instance; tenant viewers may read them", async () => {
  const m = await member();
  const id = (await h.call(m, "POST", "/api/v1/kubernetes", make())).body.cluster.id;
  kube.put(machine("web-md-b", {}));
  kube.put(machine("web-md-a", { phase: "Provisioning", ready: false }));
  kube.put(machine("web-cp-x", { cp: true }));
  kube.put(machine("other-cp", { cp: true, cluster: "other" }));
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  // Its project is the tenant's project on that cluster, whatever it is named.
  await h.db.update(placements).set({ project: "acme-lab" }).where(eq(placements.clusterId, lab));
  expect((await h.call(viewer, "GET", `/api/v1/kubernetes/${id}`)).body.project).toBe("acme-lab");
  expect((await h.call(viewer, "GET", "/api/v1/kubernetes")).body[0].project).toBe("acme-lab");
  const r = await h.call(viewer, "GET", `/api/v1/kubernetes/${id}/nodes`);
  expect(r.status).toBe(200);
  expect(r.body).toEqual([
    { name: "web-cp-x", role: "control-plane", instance: "web-cp-x-lxc", phase: "Running", version: "v1.36.4", ready: true },
    { name: "web-md-a", role: "worker", instance: "web-md-a-lxc", phase: "Provisioning", version: "v1.36.4", ready: false },
    { name: "web-md-b", role: "worker", instance: "web-md-b-lxc", phase: "Running", version: "v1.36.4", ready: true },
  ]);
  const outsider = await h.user("o@example.com");
  expect((await h.call(outsider, "GET", `/api/v1/kubernetes/${id}/nodes`)).status).toBe(404);
  kube.down = true;
  for (const what of ["nodes", "status", "activity"]) {
    const down = await h.call(viewer, "GET", `/api/v1/kubernetes/${id}/${what}`);
    expect([what, down.status, down.body.error.code]).toEqual([what, 503, "management_unavailable"]);
  }
});

/** Incendio's options, as its create form sends them. */
const spec = (o: Record<string, unknown> = {}) => ({
  controlPlane: { type: "virtual-machine", flavor: "c4-m8", profiles: ["default"], target: "" },
  worker: { type: "container", flavor: "c2-m4", profiles: ["default", "gpu"], target: "" },
  loadBalancer: { type: "lxc", flavor: "c1-m1", profiles: ["default"], target: "" },
  image: "",
  privileged: false,
  flannel: true,
  installKubeadm: false,
  podCidr: "10.244.0.0/16",
  serviceCidr: "10.96.0.0/12",
  metallb: null,
  ...o,
});
const withSpec = (o: Record<string, unknown> = {}, s: Record<string, unknown> = {}) => {
  const { size: _size, ...rest } = make({ controlPlanes: 3, workers: 2, ...o });
  return { ...rest, spec: spec(s) };
};

test("create with a spec: the quota counts its flavors (and the load balancer only when it is an instance)", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const m = await member();
  let r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec());
  expect(r.status).toBe(202);
  expect(r.body.cluster.spec).toMatchObject({ controlPlane: { flavor: "c4-m8", type: "virtual-machine" }, worker: { profiles: ["default", "gpu"] } });
  let [job] = await h.db.select().from(jobs);
  expect(job!.payload.usage).toEqual({ instances: 6, cpu: 12 + 4 + 1, memory: (24 + 8 + 1) * GiB, disk: 60 * GiB });
  r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ name: "vip" }, { loadBalancer: { type: "kube-vip", host: "10.0.0.50", interface: "" } }));
  expect(r.status).toBe(202);
  job = (await h.db.select().from(jobs)).find((j) => j.payload.name === "vip");
  expect(job!.payload.usage).toEqual({ instances: 5, cpu: 16, memory: 32 * GiB, disk: 50 * GiB });
});

test("create: a size or a spec, not both; a bad spec says why; neither is a medium cluster", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const m = await member();
  let r = await h.call(m, "POST", "/api/v1/kubernetes", { ...withSpec(), size: "small" });
  expect(r.status).toBe(400);
  r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({}, { controlPlane: { type: "container", flavor: "c1-m4", profiles: [], target: "" } }));
  expect([r.status, r.body.error.message]).toEqual([400, "A control plane needs at least 2 CPUs (kubeadm)"]);
  r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ controlPlanes: 2 }));
  expect(r.status).toBe(400);
  const { size: _s, ...bare } = make({ name: "bare" });
  r = await h.call(m, "POST", "/api/v1/kubernetes", bare);
  expect(r.status).toBe(202);
  expect(r.body.cluster.spec.controlPlane.flavor).toBe("c2-m4");
  expect(r.body.cluster.size).toBe("medium");
  r = await h.call(m, "POST", "/api/v1/kubernetes", make({ name: "five", controlPlanes: 5 }));
  expect(r.status).toBe(202);
});

test("scale a spec cluster: growth is checked against its flavors", async () => {
  const m = await member();
  await h.db.update(tenants).set({ quotas: { cpu: 30 } }).where(eq(tenants.id, acme.id));
  const r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ controlPlanes: 1, workers: 1 }));
  expect(r.status).toBe(202);
  const id = r.body.cluster.id;
  await h.db.update(k8sClusters).set({ status: "ready" }).where(eq(k8sClusters.id, id));
  await h.db.delete(jobs);
  // 4 + 2 + 1 CPUs in use; each worker adds 2.
  await h.db.update(placements).set({ usage: { instances: 3, cpu: 7, memory: 13 * GiB, disk: 30 * GiB } });
  expect((await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 12 })).status).toBe(200);
  await h.db.update(placements).set({ usage: { instances: 14, cpu: 29, memory: 35 * GiB, disk: 140 * GiB } });
  const over = await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 13 });
  expect([over.status, over.body.error.message]).toEqual([409, "Over the tenant's quota: cpu: 31 of 30"]);
  expect((await h.call(m, "GET", `/api/v1/kubernetes/${id}`)).body.spec.worker.flavor).toBe("c2-m4");
});

test("kube-vip and OVN clusters are reached at their own address: no port from the range; one cluster per address", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const m = await member();
  let r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ name: "vip" }, { loadBalancer: { type: "kube-vip", host: "10.0.0.50", interface: "" } }));
  expect(r.status).toBe(202);
  expect(r.body.cluster).toMatchObject({ endpoint: "https://10.0.0.50:6443", member: "" });
  r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ name: "ovn" }, { loadBalancer: { type: "ovn", host: "10.0.0.50", networkName: "ovn0" } }));
  expect([r.status, r.body.error.code]).toEqual([409, "conflict"]);
  // The address is in use; whose cluster it is (another tenant's, perhaps) is not said.
  expect(r.body.error.message).toBe("10.0.0.50:6443 is already a Kubernetes API endpoint");
  // The port range is untouched: an lxc cluster still gets its first port.
  r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ name: "lxc" }));
  expect(r.body.cluster.endpoint).toBe("https://10.0.0.5:16443");
});

test("on a multi-member Incus cluster, a spec without targets is pinned to the member chosen; its own targets stay", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const { clusterMembers } = await import("../db/schema.ts");
  await h.db.insert(clusterMembers).values([
    { clusterId: lab, name: "m1", url: "https://10.0.0.6:8443", status: "Online" },
    { clusterId: lab, name: "m2", url: "https://10.0.0.7:8443", status: "Online" },
  ]);
  const m = await member();
  let r = await h.call(m, "POST", "/api/v1/kubernetes", { ...withSpec(), member: "m2" });
  expect(r.body.cluster.spec).toMatchObject({ controlPlane: { target: "m2" }, worker: { target: "m2" }, loadBalancer: { target: "m2" } });
  // The load balancer's member decides where the forward goes.
  r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({ name: "own" }, { loadBalancer: { type: "lxc", flavor: "c1-m1", profiles: [], target: "m1" }, worker: { type: "container", flavor: "c2-m4", profiles: [], target: "@all" } }));
  expect(r.body.cluster).toMatchObject({ member: "m1", endpoint: "https://10.0.0.6:16443" });
  expect(r.body.cluster.spec).toMatchObject({ controlPlane: { target: "m1" }, worker: { target: "@all" }, loadBalancer: { target: "m1" } });
});

test("scale applies our ClusterClass before the Cluster (clusters made before it changed)", async () => {
  const { m, id } = await readyCluster();
  kube.applied.length = 0;
  expect((await h.call(m, "PATCH", `/api/v1/kubernetes/${id}`, { workers: 0 })).status).toBe(200);
  const kinds = kube.applied.map((o) => o.kind);
  expect(kinds.indexOf("ClusterClass")).toBeGreaterThanOrEqual(0);
  expect(kinds.indexOf("ClusterClass")).toBeLessThan(kinds.indexOf("Cluster"));
});

test("a cluster's status: CAPI's conditions, its phase and why it is not available yet", async () => {
  const { m, id } = await readyCluster();
  kube.put({
    apiVersion: "cluster.x-k8s.io/v1beta2",
    kind: "Cluster",
    metadata: { name: "web", namespace: "ic-acme" },
    status: {
      phase: "Provisioned",
      conditions: [
        { type: "Available", status: "False", reason: "NotAvailable", message: "* ControlPlaneAvailable: waiting for etcd", lastTransitionTime: "2026-10-12T10:00:00Z" },
        { type: "InfrastructureReady", status: "True", reason: "Ready", lastTransitionTime: "2026-10-12T09:59:00Z" },
      ],
    },
  });
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  const r = await h.call(viewer, "GET", `/api/v1/kubernetes/${id}/status`);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({
    phase: "Provisioned",
    message: "* ControlPlaneAvailable: waiting for etcd",
    endpoint: "https://10.0.0.5:16443",
    conditions: [
      { type: "Available", status: "False", reason: "NotAvailable", message: "* ControlPlaneAvailable: waiting for etcd", lastTransitionTime: "2026-10-12T10:00:00Z" },
      { type: "InfrastructureReady", status: "True", reason: "Ready", message: "", lastTransitionTime: "2026-10-12T09:59:00Z" },
    ],
  });
  const outsider = await h.user("o@example.com");
  expect((await h.call(outsider, "GET", `/api/v1/kubernetes/${id}/status`)).status).toBe(404);
  void m;
});

test("on a multi-member Incus cluster, a kube-vip cluster's nodes are pinned to one member too", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const { clusterMembers } = await import("../db/schema.ts");
  await h.db.insert(clusterMembers).values([
    { clusterId: lab, name: "m1", url: "https://10.0.0.6:8443", status: "Online" },
    { clusterId: lab, name: "m2", url: "https://10.0.0.7:8443", status: "Online" },
  ]);
  const m = await member();
  const r = await h.call(m, "POST", "/api/v1/kubernetes", { ...withSpec({ name: "vip" }, { loadBalancer: { type: "kube-vip", host: "10.0.0.50", interface: "" } }), member: "m2" });
  expect(r.status).toBe(202);
  expect(r.body.cluster).toMatchObject({ endpoint: "https://10.0.0.50:6443", spec: { controlPlane: { target: "m2" }, worker: { target: "m2" } } });
});

test("a create checks MetalLB's addresses like the cluster page does", async () => {
  const m = await member();
  const r = await h.call(m, "POST", "/api/v1/kubernetes", withSpec({}, { metallb: { addresses: ["10.0.0.200-10.0.0.210 10.0.1.0/29"] } }));
  expect([r.status, r.body.error.code]).toEqual([400, "invalid_request"]);
});

test("a cluster's activity leaves out a longer-named sibling's objects", async () => {
  await h.db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  const m = await member();
  const id = (await h.call(m, "POST", "/api/v1/kubernetes", make())).body.cluster.id as string;
  await h.call(m, "POST", "/api/v1/kubernetes", make({ name: "web-prod" }));
  const later = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
  const event = (name: string, kind: string, involved: string) =>
    kube.put({ apiVersion: "v1", kind: "Event", metadata: { name, namespace: "ic-acme" }, involvedObject: { kind, name: involved }, reason: "Created", message: `made ${involved}`, lastTimestamp: later(5), type: "Normal" } as never);
  event("e1", "Machine", "web-md-0-abc");
  event("e2", "Cluster", "web-prod");
  event("e3", "Machine", "web-prod-md-0-xyz");
  const r = await h.call(m, "GET", `/api/v1/kubernetes/${id}/activity`);
  expect((r.body.entries as Array<{ source: string; object?: string }>).filter((e) => e.source === "event").map((e) => e.object)).toEqual(["Machine/web-md-0-abc"]);
});

test("a cluster's activity: Events on its objects and its jobs, oldest first", async () => {
  const m = await member();
  const { body } = await h.call(m, "POST", "/api/v1/kubernetes", make());
  const id = body.cluster.id as string;
  // After the create, as CAPI's events are.
  const later = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
  const event = (name: string, kind: string, involved: string, at: string, o: Record<string, unknown> = {}) =>
    kube.put({ apiVersion: "v1", kind: "Event", metadata: { name, namespace: "ic-acme" }, involvedObject: { kind, name: involved }, reason: "Created", message: `made ${involved}`, lastTimestamp: at, type: "Normal", ...o } as never);
  event("e1", "Machine", "web-md-0-abc", later(5));
  event("e2", "Cluster", "web", later(10), { type: "Warning", reason: "Failed", message: "no address" });
  event("e3", "Cluster", "other", later(15));
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  const r = await h.call(viewer, "GET", `/api/v1/kubernetes/${id}/activity`);
  expect(r.status).toBe(200);
  const entries = r.body.entries as Array<{ source: string; level: string; object?: string; message: string }>;
  expect(entries.filter((e) => e.source === "event").map((e) => [e.object, e.level, e.message])).toEqual([
    ["Machine/web-md-0-abc", "info", "Created: made web-md-0-abc"],
    ["Cluster/web", "warning", "Failed: no address"],
  ]);
  // The create job, queued.
  expect(entries.filter((e) => e.source === "incuscloud").map((e) => [e.object, e.level])).toEqual([["k8s-create", "info"]]);
  expect(entries[0]!.source).toBe("incuscloud");
});

test("MetalLB: members set its addresses (audited, a job installs it); an empty list removes the pool", async () => {
  const { m, id } = await readyCluster();
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  expect((await h.call(viewer, "PUT", `/api/v1/kubernetes/${id}/metallb`, { addresses: ["10.0.0.200-10.0.0.220"] })).status).toBe(403);
  let r = await h.call(m, "PUT", `/api/v1/kubernetes/${id}/metallb`, { addresses: ["10.0.0.200-10.0.0.300"] });
  expect([r.status, r.body.error.code]).toEqual([400, "invalid_request"]);
  r = await h.call(m, "PUT", `/api/v1/kubernetes/${id}/metallb`, { addresses: [" 10.0.0.200-10.0.0.220 "] });
  expect(r.status).toBe(202);
  expect(r.body.job.type).toBe("k8s-metallb");
  expect((await rows())[0]!.spec.metallb).toEqual({ addresses: ["10.0.0.200-10.0.0.220"] });
  const [job] = await h.db.select().from(jobs).where(eq(jobs.type, "k8s-metallb"));
  expect(job!.payload).toMatchObject({ k8sId: id, name: "web" });
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "kubernetes.metallb"))).length).toBe(1);
  r = await h.call(m, "PUT", `/api/v1/kubernetes/${id}/metallb`, { addresses: [] });
  expect(r.status).toBe(202);
  expect((await rows())[0]!.spec.metallb).toBeNull();
});

test("MetalLB's state is read from the workload cluster; before its kubeconfig exists, it says so", async () => {
  const workload = new FakeKube();
  const off = await harness({ kube, k8sPorts: [16443, 16445], workloadKube: () => workload });
  const lab2 = (await off.db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  const t = await off.tenant("acme");
  await off.db.insert(placements).values({ tenantId: t.id, clusterId: lab2, project: "acme", status: "ready", usage: { instances: 0, cpu: 0, memory: 0, disk: 0 } });
  const m = await off.user("m@example.com", { tenants: { [t.id]: "member" } });
  const { body } = await off.call(m, "POST", "/api/v1/kubernetes", { tenantId: t.id, clusterId: lab2, name: "web", version: "v1.36.4", controlPlanes: 1, workers: 1 });
  const id = body.cluster.id as string;
  let r = await off.call(m, "GET", `/api/v1/kubernetes/${id}/metallb`);
  expect(r.body).toEqual({ requested: null, installed: false, ready: false, addresses: [], message: "The kubeconfig of web is not available yet" });
  kube.put({ apiVersion: "v1", kind: "Secret", metadata: { name: "web-kubeconfig", namespace: "ic-acme" }, data: { value: Buffer.from("kubeconfig").toString("base64") } } as never);
  workload.put({ apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "controller", namespace: "metallb-system" }, status: { conditions: [{ type: "Available", status: "True" }] } });
  workload.put({ apiVersion: "metallb.io/v1beta1", kind: "IPAddressPool", metadata: { name: "incendio", namespace: "metallb-system" }, spec: { addresses: ["10.0.0.200/29"] } });
  r = await off.call(m, "GET", `/api/v1/kubernetes/${id}/metallb`);
  expect(r.body).toEqual({ requested: null, installed: true, ready: true, addresses: ["10.0.0.200/29"], message: "" });
});

test("a User sees and deletes their own Kubernetes cluster, not another's", async () => {
  const u = await h.user("u@example.com");
  await h.db.insert(aclEntries).values({ path: "/tenants/acme", role: "user", userId: u.id });
  const mine = (await h.call(u, "POST", "/api/v1/kubernetes", make({ name: "mine" }))).body.cluster.id as string;
  const m = await member();
  const theirs = (await h.call(m, "POST", "/api/v1/kubernetes", make({ name: "theirs" }))).body.cluster.id as string;
  await h.db.update(jobs).set({ state: "failed" });
  expect((await h.call(u, "GET", "/api/v1/kubernetes")).body.map((c: { name: string }) => c.name)).toEqual(["mine"]);
  expect((await h.call(u, "GET", `/api/v1/kubernetes/${theirs}`)).status).toBe(404);
  expect((await h.call(u, "DELETE", `/api/v1/kubernetes/${theirs}`)).status).toBe(404);
  expect((await h.call(u, "DELETE", `/api/v1/kubernetes/${mine}`)).status).toBe(202);
});
