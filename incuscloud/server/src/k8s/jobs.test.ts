import { specFromSize } from "./model.ts";
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, jobs, k8sClusters, placements, tenants } from "../db/schema.ts";
import { fingerprintOf } from "../incus/certs.ts";
import type { JobContext } from "../jobs/types.ts";
import { FakeKube } from "./fake-kube.ts";
import { FakeCluster } from "./fake-cluster.ts";
import { ensureCredentials } from "./credentials.ts";
import { ensureForward } from "./endpoint.ts";
import { k8sCreateHandler, k8sDeleteHandler } from "./jobs.ts";

let db: Db;
let kube: FakeKube;
let incus: FakeCluster;
let cluster: typeof clusters.$inferSelect;
let tenant: typeof tenants.$inferSelect;

beforeEach(async () => {
  db = await testDb();
  kube = new FakeKube();
  incus = new FakeCluster();
  incus.fingerprintOf = (b64) => fingerprintOf(`-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`);
  [cluster] = (await db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "SERVER PEM", clientCert: "", clientKeyEnc: "" }).returning()) as [typeof clusters.$inferSelect];
  [tenant] = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning()) as [typeof tenants.$inferSelect];
  await db.insert(placements).values({ tenantId: tenant.id, clusterId: cluster.id, project: "acme", status: "ready" });
});

const addK8s = async (name: string, port: number, status: "creating" | "deleting" | "ready" = "creating") =>
  (
    await db
      .insert(k8sClusters)
      .values({ tenantId: tenant.id, clusterId: cluster.id, name, namespace: "ic-acme", version: "v1.36.4", controlPlanes: 1, workers: 1, size: "small", spec: specFromSize("small"), endpointHost: "10.0.0.5", endpointPort: port, status, createdBy: "u" })
      .returning()
  )[0]!;
const rowOf = async (id: string) => (await db.select().from(k8sClusters).where(eq(k8sClusters.id, id)))[0];
const clusterObj = (name: string) => kube.objects.get(`cluster.x-k8s.io/v1beta2|Cluster|ic-acme|${name}`);

const lbInstance = (name: string, address?: string) => ({
  name: `${name}-lb-x1`,
  project: "acme",
  location: "lab",
  config: { "user.cluster-name": name, "user.cluster-namespace": "ic-acme", "user.cluster-role": "loadbalancer" },
  state: address ? { network: { eth0: { addresses: [{ family: "inet", address, scope: "global" }] } } } : {},
});
const available = (name: string, ok = true) =>
  kube.setStatus("cluster.x-k8s.io/v1beta2", "Cluster", "ic-acme", name, { conditions: [{ type: "ControlPlaneAvailable", status: ok ? "True" : "False", message: ok ? "" : "waiting" }] });

/** Runs a handler; `step` plays the controllers, once per wait. */
function run(handler: "create" | "delete", k8sId: string, step: (n: number) => void | Promise<void> = () => {}, o: { deadlineMs?: number } = {}) {
  let n = 0;
  const stages: string[] = [];
  const opts = { kube, deadlineMs: o.deadlineMs ?? 60_000, sleep: async () => step(++n) };
  const h = handler === "create" ? k8sCreateHandler(opts) : k8sDeleteHandler(opts);
  const p = h({
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "00000000-0000-4000-8000-0000000000a1", tenantId: tenant.id, payload: { k8sId } },
    signal: new AbortController().signal,
    progress: async (pr: { stage: string }) => void stages.push(pr.stage),
    clientFor: async () => ({ client: incus.client, row: cluster }),
  } as unknown as JobContext);
  return { p, stages };
}

test("create: namespace and credentials, the Cluster on the preset endpoint, then the LB, then the forward, then available", async () => {
  const row = await addK8s("web", 16443);
  const seen: string[] = [];
  const { p, stages } = run("create", row.id, (n) => {
    if (n === 1) {
      seen.push(`cluster applied: ${!!clusterObj("web")}`);
      incus.instances.push(lbInstance("web"));
    }
    if (n === 2) incus.instances[0] = lbInstance("web", "10.1.0.9");
    if (n === 3) {
      seen.push(`forward before available: ${incus.forwards.size}`);
      available("web");
    }
  });
  expect(await p).toEqual({ id: row.id, endpoint: "https://10.0.0.5:16443" });
  expect(seen).toEqual(["cluster applied: true", "forward before available: 1"]);
  expect(kube.objects.get("v1|Namespace||ic-acme")).toBeDefined();
  expect(kube.objects.get("v1|Secret|ic-acme|incus-lab")).toBeDefined();
  expect((clusterObj("web") as unknown as { spec: { controlPlaneEndpoint: unknown } }).spec.controlPlaneEndpoint).toEqual({ host: "10.0.0.5", port: 16443 });
  expect(incus.forwards.get("incusbr0|10.0.0.5")!.ports).toEqual([{ description: `incuscloud k8s ${row.id}`, protocol: "tcp", listen_port: "16443", target_port: "6443", target_address: "10.1.0.9" }]);
  expect(await rowOf(row.id)).toMatchObject({ status: "ready", statusMessage: "" });
  expect(stages).toEqual(["namespace", "credentials", "cluster", "load-balancer", "forward", "control-plane"]);
});

test("create: a tenant just placed on the cluster (by an operator) is waited for, then the Cluster goes on", async () => {
  await db.update(placements).set({ status: "pending" }).where(eq(placements.clusterId, cluster.id));
  const row = await addK8s("web", 16443);
  const seen: string[] = [];
  const { p, stages } = run(
    "create",
    row.id,
    async (n) => {
      if (n === 1) {
        seen.push(`cluster before ready: ${!!clusterObj("web")}`);
        await db.update(placements).set({ status: "ready" }).where(eq(placements.clusterId, cluster.id));
      }
    },
    { deadlineMs: 50 },
  );
  await expect(p).rejects.toThrow(/load balancer/);
  expect(seen).toEqual(["cluster before ready: false"]);
  expect(clusterObj("web")).toBeDefined();
  expect(stages.slice(0, 2)).toEqual(["placement", "namespace"]);
});

test("create: a placement that never gets ready fails the job, saying why", async () => {
  await db.update(placements).set({ status: "error", statusMessage: "no space" }).where(eq(placements.clusterId, cluster.id));
  const row = await addK8s("web", 16443);
  await expect(run("create", row.id, () => {}, { deadlineMs: 0 }).p).rejects.toThrow("The tenant's project acme on lab is not ready (error: no space)");
  expect(clusterObj("web")).toBeUndefined();
});

test("create: a control plane that never becomes available fails the job and marks the cluster", async () => {
  const row = await addK8s("web", 16443);
  incus.instances.push(lbInstance("web", "10.1.0.9"));
  // CAPI says why it is not available yet; apply keeps the status.
  kube.put({ apiVersion: "cluster.x-k8s.io/v1beta2", kind: "Cluster", metadata: { name: "web", namespace: "ic-acme" } });
  available("web", false);
  const { p } = run("create", row.id, () => {}, { deadlineMs: 0 });
  await expect(p).rejects.toThrow("The control plane of web did not become available in time (waiting)");
  expect(await rowOf(row.id)).toMatchObject({ status: "error", statusMessage: "The control plane of web did not become available in time (waiting)" });
});

async function twoClusters() {
  const web = await addK8s("web", 16443, "ready");
  const api = await addK8s("api", 16444, "ready");
  await ensureCredentials({ db, kube, client: incus.client }, { tenant, cluster, project: "acme" });
  for (const r of [web, api]) {
    await kube.apply({ apiVersion: "cluster.x-k8s.io/v1beta2", kind: "Cluster", metadata: { name: r.name, namespace: "ic-acme" } });
    await ensureForward(incus.client, { network: "incusbr0", member: "", host: "10.0.0.5", port: r.endpointPort, target: "10.1.0.9", id: r.id });
  }
  return { web, api };
}

test("delete: waits for the Cluster to go, removes its forward port and row; credentials stay while another cluster uses them", async () => {
  const { web, api } = await twoClusters();
  const { p } = run("delete", web.id, (n) => {
    // CAPN removes the instances, then the Cluster goes.
    if (n === 1) kube.objects.delete("cluster.x-k8s.io/v1beta2|Cluster|ic-acme|web");
  });
  await p;
  expect(kube.deleted).toContain("cluster.x-k8s.io/v1beta2|Cluster|ic-acme|web");
  expect(await rowOf(web.id)).toBeUndefined();
  expect(incus.forwards.get("incusbr0|10.0.0.5")!.ports.map((x) => x.description)).toEqual([`incuscloud k8s ${api.id}`]);
  expect(incus.certificates.size).toBe(1);

  expect(kube.deleted).not.toContain("v1|Namespace||ic-acme");
  await run("delete", api.id, () => void kube.objects.delete("cluster.x-k8s.io/v1beta2|Cluster|ic-acme|api")).p;
  // The tenant's last Kubernetes cluster anywhere: its namespace goes too.
  expect(kube.deleted).toContain("v1|Namespace||ic-acme");
  expect(incus.certificates.size).toBe(0);
  expect(incus.forwards.size).toBe(0);
  expect(kube.objects.get("v1|Secret|ic-acme|incus-lab")).toBeUndefined();
});

test("delete: CAPN instances left behind are removed, after the operations still creating them finish; other clusters' stay", async () => {
  const { web, api } = await twoClusters();
  const worker = { ...lbInstance("web"), name: "web-md-0-abc", config: { "user.cluster-name": "web", "user.cluster-namespace": "ic-acme", "user.cluster-role": "worker" } };
  incus.instances.push(worker, lbInstance("api"));
  // A load balancer create CAPN gave up on, still running: it lands later.
  incus.running.push({ id: "op-late", project: "acme", instances: ["web-lb-x1"], finish: () => void incus.instances.push(lbInstance("web")) });
  const { p, stages } = run("delete", web.id, (n) => {
    if (n === 1) kube.objects.delete("cluster.x-k8s.io/v1beta2|Cluster|ic-acme|web");
  });
  await p;
  expect(incus.calls.some((c) => c.method === "WAIT" && c.path.endsWith("op-late"))).toBe(true);
  expect(incus.instances.map((i) => i.name)).toEqual(["api-lb-x1"]);
  expect(stages).toContain("leftovers");
  expect(await rowOf(api.id)).toBeDefined();
});

test("delete with the management cluster unreachable fails and keeps the row, marked deleting", async () => {
  const { web } = await twoClusters();
  kube.down = true;
  await expect(run("delete", web.id).p).rejects.toThrow("ECONNREFUSED");
  expect(await rowOf(web.id)).toMatchObject({ status: "deleting" });
  expect(incus.forwards.get("incusbr0|10.0.0.5")!.ports).toHaveLength(2);
});

test("the job types exist only when a management cluster is configured", async () => {
  const { jobHandlers } = await import("../jobs/handlers.ts");
  expect(Object.keys(jobHandlers({ kube }))).toEqual(expect.arrayContaining(["k8s-create", "k8s-delete"]));
  expect(Object.keys(jobHandlers())).not.toContain("k8s-create");
});

test("a create stopped by a delete leaves the row deleting, not failed", async () => {
  const row = await addK8s("web", 16443);
  const abort = new AbortController();
  const p = k8sCreateHandler({ kube, deadlineMs: 60_000, sleep: async () => {
    // The API marks it deleting and asks the create to stop.
    await db.update(k8sClusters).set({ status: "deleting" }).where(eq(k8sClusters.id, row.id));
    abort.abort(new Error("Cancelled"));
  } })({
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "00000000-0000-4000-8000-0000000000a2", tenantId: tenant.id, payload: { k8sId: row.id } },
    signal: abort.signal,
    progress: async () => {},
    clientFor: async () => ({ client: incus.client, row: cluster }),
  } as unknown as JobContext);
  await expect(p).rejects.toThrow("Cancelled");
  expect(await rowOf(row.id)).toMatchObject({ status: "deleting" });
});

test("delete waits for a create of the same cluster that is still running", async () => {
  const { web } = await twoClusters();
  const { enqueueJob } = await import("../jobs/queue.ts");
  const create = await enqueueJob(db, { type: "k8s-create", payload: { k8sId: web.id }, actor: { type: "user", id: "u" }, tenantId: tenant.id });
  await db.update(jobs).set({ state: "running" }).where(eq(jobs.id, create.id));
  const seen: string[] = [];
  const { p } = run("delete", web.id, async (n) => {
    seen.push(`wait ${n}: cluster deleted ${kube.deleted.length > 0}`);
    if (n === 1) await db.update(jobs).set({ state: "cancelled" }).where(eq(jobs.id, create.id));
    if (n === 2) kube.objects.delete("cluster.x-k8s.io/v1beta2|Cluster|ic-acme|web");
  });
  await p;
  expect(seen[0]).toBe("wait 1: cluster deleted false");
  expect(await rowOf(web.id)).toBeUndefined();
});

const addVip = async (name: string, status: "creating" | "ready" = "creating") =>
  (
    await db
      .insert(k8sClusters)
      .values({ tenantId: tenant.id, clusterId: cluster.id, name, namespace: "ic-acme", version: "v1.36.4", controlPlanes: 1, workers: 1, spec: { ...specFromSize("small"), loadBalancer: { type: "kube-vip", host: "10.0.0.50", interface: "" } }, endpointHost: "10.0.0.50", endpointPort: 6443, status, createdBy: "u" })
      .returning()
  )[0]!;

test("create with kube-vip: no load balancer to wait for and no forward; ready once the control plane is available", async () => {
  const row = await addVip("vip");
  const { p, stages } = run("create", row.id, (n) => {
    if (n === 1) available("vip");
  });
  expect(await p).toEqual({ id: row.id, endpoint: "https://10.0.0.50:6443" });
  expect(incus.forwards.size).toBe(0);
  expect(stages).toEqual(["namespace", "credentials", "cluster", "control-plane"]);
});

test("delete of a kube-vip cluster touches no forward", async () => {
  const row = await addVip("vip", "ready");
  await ensureCredentials({ db, kube, client: incus.client }, { tenant, cluster, project: "acme" });
  await kube.apply({ apiVersion: "cluster.x-k8s.io/v1beta2", kind: "Cluster", metadata: { name: "vip", namespace: "ic-acme" } });
  await run("delete", row.id, () => void kube.objects.delete("cluster.x-k8s.io/v1beta2|Cluster|ic-acme|vip")).p;
  expect(await rowOf(row.id)).toBeUndefined();
  expect(incus.calls.filter((c) => c.path.includes("/forwards"))).toEqual([]);
});
