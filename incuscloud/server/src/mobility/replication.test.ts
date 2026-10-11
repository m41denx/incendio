import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, jobs, replicationPolicies } from "../db/schema.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { JobContext } from "../jobs/types.ts";
import { stubCluster, type StubInstance } from "../test/stub-cluster.ts";
import type { SourceInstance, TargetFacts } from "./preflight.ts";
import { failoverHandler, replicateHandler, scheduleReplication, TAG_REPLICA_OF } from "./replication.ts";
import type { TransferOptions } from "./transfer.ts";

let db: Db;
let log: string[];
let ids: { a: string; b: string };
let policyId: string;

const source = (): SourceInstance => ({ name: "web", type: "container", status: "Running", architecture: "aarch64", config: { "volatile.uuid": "u" }, devices: {}, profiles: ["default"], expandedDevices: { root: { type: "disk", path: "/", pool: "p" } }, snapshots: 0, apiExtensions: [] });
const target = (): TargetFacts => ({ projectExists: true, architectures: ["aarch64"], pools: ["default"], networks: [], profiles: ["default"], instanceNames: [], defaultProfileDevices: {}, apiExtensions: [] });

beforeEach(async () => {
  db = await testDb();
  log = [];
  const mk = async (name: string) => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k", inventoryAt: new Date() }).returning())[0]!.id;
  ids = { a: await mk("A"), b: await mk("B") };
  policyId = (await db.insert(replicationPolicies).values({ sourceClusterId: ids.a, sourceProject: "acme", instanceName: "web", targetClusterId: ids.b, targetProject: "acme", targetName: "web-dr", intervalS: 600, createdBy: "u" }).returning())[0]!.id;
});

function setup(o: { replica?: StubInstance; fail?: string } = {}) {
  const a = stubCluster("A", { web: { status: "Running", type: "container", config: {} } }, log);
  const b = stubCluster("B", o.replica ? { "web-dr": o.replica } : {}, log);
  const transfers: TransferOptions[] = [];
  const deps = {
    sourceFacts: async () => source(),
    targetFacts: async () => target(),
    transfer: async (t: TransferOptions) => {
      transfers.push(t);
      log.push(`transfer${t.refresh ? " refresh" : ""}`);
      if (o.fail) throw new Error(o.fail);
      b.instances[t.request.name] = { status: "Stopped", type: "container", config: t.request.config };
      return { transport: "direct" as const };
    },
  };
  const ctx = (payload: Record<string, unknown>, id = "job-1") =>
    ({
      db,
      secretKey: Buffer.alloc(32),
      job: { id, payload },
      signal: new AbortController().signal,
      progress: async () => {},
      clientFor: async (cid: string) => ({ client: cid === ids.a ? a : b, row: { id: cid, name: cid === ids.a ? "A" : "B", serverCert: "PEM", url: cid === ids.a ? a.url : b.url } }),
    }) as unknown as JobContext;
  return { a, b, transfers, replicate: () => replicateHandler(deps)(ctx({ policyId })), failover: (stopSource: boolean) => failoverHandler()(ctx({ policyId, stopSource })) };
}
const policy = async () => (await db.select().from(replicationPolicies).where(eq(replicationPolicies.id, policyId)))[0]!;

test("the first run copies a stopped, tagged replica; later runs refresh it", async () => {
  const s = setup();
  await s.replicate();
  expect(s.b.instances["web-dr"]).toMatchObject({ status: "Stopped", config: { [TAG_REPLICA_OF]: policyId } });
  expect(s.transfers[0]).toMatchObject({ refresh: false, srcProject: "acme", dstProject: "acme", name: "web", request: { name: "web-dr" } });
  expect((await policy()).lastSuccessAt).not.toBeNull();
  await s.replicate();
  expect(log).toEqual(["transfer", "transfer refresh"]);
  expect(s.transfers[1]!.request.config[TAG_REPLICA_OF]).toBe(policyId);
});

test("an instance on the target that is not this policy's replica is never overwritten", async () => {
  const s = setup({ replica: { status: "Running", type: "container", config: { [TAG_REPLICA_OF]: "another-policy" } } });
  await expect(s.replicate()).rejects.toThrow('A different instance named "web-dr" exists on the target; it is not overwritten');
  expect(log).toEqual([]);
  expect((await policy()).lastError).toContain("not overwritten");
});

test("a failed run records its error and removes a first copy it left behind", async () => {
  const s = setup({ fail: "Target: disk full" });
  await expect(s.replicate()).rejects.toThrow("disk full");
  expect((await policy()).lastError).toBe("Target: disk full");
  expect((await policy()).lastSuccessAt).toBeNull();
});

test("failover: stop the source, promote the replica, start it; the policy stops", async () => {
  const s = setup({ replica: { status: "Stopped", type: "container", config: { [TAG_REPLICA_OF]: policyId, "limits.memory": "1GiB" } } });
  const r = await s.failover(true);
  expect(log).toEqual(["A stop web", "B update web-dr", "B start web-dr"]);
  expect(s.b.instances["web-dr"]!.config).toEqual({ "limits.memory": "1GiB", "user.incuscloud.promoted-from": `${ids.a}/acme/web` });
  expect(r).toEqual({ targetClusterId: ids.b, targetProject: "acme", targetName: "web-dr", warnings: [] });
  expect(await policy()).toMatchObject({ state: "failed-over", enabled: false });
});

test("failover goes ahead when the source is unreachable, with a warning", async () => {
  const s = setup({ replica: { status: "Stopped", type: "container", config: { [TAG_REPLICA_OF]: policyId } } });
  s.a.reachable = false;
  const r = await s.failover(true);
  expect(r!.warnings).toEqual(["The source could not be stopped: Cluster: A is unreachable"]);
  expect(s.b.instances["web-dr"]!.status).toBe("Running");
});

test("failover needs this policy's replica", async () => {
  const s = setup();
  await expect(s.failover(false)).rejects.toThrow("There is no replica to fail over to");
  expect((await policy()).state).toBe("active");
});

test("the scheduler queues due policies once; not while a run is active; not disabled or failed-over ones", async () => {
  await scheduleReplication(db);
  const queued = await db.select().from(jobs);
  expect(queued.map((j) => [j.type, j.payload, j.instanceKey])).toEqual([["replicate", { policyId }, `${ids.a}/acme/web`]]);
  expect((await policy()).lastJobId).toBe(queued[0]!.id);
  await db.update(replicationPolicies).set({ lastRunAt: new Date(Date.now() - 3_600_000) });
  await scheduleReplication(db);
  expect(await db.select().from(jobs)).toHaveLength(1);
  await db.update(jobs).set({ state: "succeeded" });
  await scheduleReplication(db);
  expect(await db.select().from(jobs)).toHaveLength(2);
  await db.update(jobs).set({ state: "succeeded" });
  await db.update(replicationPolicies).set({ lastRunAt: new Date(Date.now() - 3_600_000), enabled: false });
  await scheduleReplication(db);
  await db.update(replicationPolicies).set({ enabled: true, state: "failed-over" });
  await scheduleReplication(db);
  expect(await db.select().from(jobs)).toHaveLength(2);
  // A migration of the same instance holds it too.
  await db.update(replicationPolicies).set({ state: "active" });
  await enqueueJob(db, { type: "migrate", payload: {}, actor: { type: "user", id: "u" }, instanceKey: `${ids.a}/acme/web` });
  await scheduleReplication(db);
  expect((await db.select().from(jobs)).filter((j) => j.type === "replicate")).toHaveLength(2);
});
