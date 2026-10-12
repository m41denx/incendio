import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, k8sClusters, placements, tenants } from "../db/schema.ts";
import { acquireLease } from "../reconcile/lease.ts";
import { FakeKube } from "./fake-kube.ts";
import { FakeCluster } from "./fake-cluster.ts";
import { ensureForward } from "./endpoint.ts";
import { K8sWorker } from "./worker.ts";

let db: Db;
let kube: FakeKube;
let incus: FakeCluster;
let clusterId: string;
let tenantId: string;
let nextPort: number;

beforeEach(async () => {
  db = await testDb();
  nextPort = 16443;
  kube = new FakeKube();
  incus = new FakeCluster();
  clusterId = (await db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
  tenantId = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning())[0]!.id;
  await db.insert(placements).values({ tenantId, clusterId, project: "acme", status: "ready" });
});

const worker = () => new K8sWorker({ db, kube, clientFor: async () => incus.client }, { holder: "me" });
const addK8s = async (name: string, status: "creating" | "provisioning" | "ready" | "deleting" | "error" = "ready", workers = 1) =>
  (
    await db
      .insert(k8sClusters)
      .values({ tenantId, clusterId, name, namespace: "ic-acme", version: "v1.36.4", controlPlanes: 1, workers, size: "small", endpointHost: "10.0.0.5", endpointPort: nextPort++, status, createdBy: "u" })
      .returning()
  )[0]!;
const rowOf = async (id: string) => (await db.select().from(k8sClusters).where(eq(k8sClusters.id, id)))[0]!;

function capi(name: string, o: { available?: boolean; why?: string; machines?: boolean[] } = {}) {
  kube.put({
    apiVersion: "cluster.x-k8s.io/v1beta2",
    kind: "Cluster",
    metadata: { name, namespace: "ic-acme" },
    status: { conditions: [{ type: "ControlPlaneAvailable", status: o.available === false ? "False" : "True", message: o.why ?? "" }] },
  });
  (o.machines ?? [true, true]).forEach((ready, i) =>
    kube.put({
      apiVersion: "cluster.x-k8s.io/v1beta2",
      kind: "Machine",
      metadata: { name: `${name}-m${i}`, namespace: "ic-acme", labels: { "cluster.x-k8s.io/cluster-name": name } },
      status: { phase: "Running", conditions: [{ type: "Ready", status: ready ? "True" : "False" }] },
    }),
  );
}
const lb = (name: string, address: string) => ({
  name: `${name}-lb`,
  project: "acme",
  location: "lab",
  config: { "user.cluster-name": name, "user.cluster-namespace": "ic-acme", "user.cluster-role": "loadbalancer" },
  state: { network: { eth0: { addresses: [{ family: "inet", address, scope: "global" }] } } },
});

test("a cluster with its control plane available and every node ready is ready", async () => {
  const r = await addK8s("web", "ready");
  capi("web");
  await worker().tick();
  expect(await rowOf(r.id)).toMatchObject({ status: "ready", statusMessage: "", nodes: 2, nodesReady: 2 });
  expect((await rowOf(r.id)).syncedAt).not.toBeNull();
});

test("nodes not ready, or a control plane not available, make it degraded with the reason", async () => {
  const a = await addK8s("web", "ready");
  capi("web", { machines: [true, false] });
  const b = await addK8s("api", "ready");
  capi("api", { available: false, why: "etcd has no quorum" });
  await worker().tick();
  expect(await rowOf(a.id)).toMatchObject({ status: "degraded", statusMessage: "1 of 2 nodes ready", nodesReady: 1 });
  expect(await rowOf(b.id)).toMatchObject({ status: "degraded", statusMessage: "Control plane not available: etcd has no quorum" });
});

test("a failed create recovers to ready once CAPI gets there; a Cluster gone from the management cluster is an error", async () => {
  const a = await addK8s("web", "error");
  capi("web");
  const b = await addK8s("api", "ready");
  await worker().tick();
  expect(await rowOf(a.id)).toMatchObject({ status: "ready" });
  expect(await rowOf(b.id)).toMatchObject({ status: "error", statusMessage: "Its Cluster is missing from the management cluster" });
});

test("rows owned by a running job keep their status; provisioning ones get node counts", async () => {
  const c = await addK8s("web", "provisioning");
  capi("web", { machines: [true, false] });
  const d = await addK8s("api", "deleting");
  await worker().tick();
  expect(await rowOf(c.id)).toMatchObject({ status: "provisioning", nodes: 2, nodesReady: 1 });
  expect(await rowOf(d.id)).toMatchObject({ status: "deleting", nodes: 0 });
});

test("the forward follows the load balancer's address", async () => {
  const r = await addK8s("web", "ready");
  capi("web");
  await ensureForward(incus.client, { network: "incusbr0", member: "", host: "10.0.0.5", port: 16443, target: "10.1.0.9", id: r.id });
  incus.instances = [lb("web", "10.1.0.23")];
  await worker().tick();
  expect(incus.forwards.get("incusbr0|10.0.0.5")!.ports[0]!.target_address).toBe("10.1.0.23");
  const puts = incus.calls.filter((c) => c.method === "PUT").length;
  await worker().tick();
  expect(incus.calls.filter((c) => c.method === "PUT").length).toBe(puts);
});

test("another replica holding the lease means no pass here", async () => {
  const r = await addK8s("web", "ready");
  capi("web", { machines: [false, false] });
  expect(await acquireLease(db, "kubernetes", "other", 60_000)).toBe(true);
  await worker().tick();
  expect(await rowOf(r.id)).toMatchObject({ status: "ready", nodes: 0 });
});
