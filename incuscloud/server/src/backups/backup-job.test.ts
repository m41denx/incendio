import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { backupPolicies, backups, backupTargets, clusters, jobs } from "../db/schema.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { JobContext } from "../jobs/types.ts";
import { seal } from "../lib/secrets.ts";
import { stubCluster, type StubBackups } from "../test/stub-cluster.ts";
import { backupHandler, incusUploadRegion, scheduleBackups } from "./backup-job.ts";
import { memoryStore } from "./store.ts";

const KEY = Buffer.alloc(32, 1);
let db: Db;
let log: string[];
let clusterId: string;
let targetId: string;
let store: ReturnType<typeof memoryStore>;

beforeEach(async () => {
  db = await testDb();
  log = [];
  store = memoryStore();
  clusterId = (await db.insert(clusters).values({ name: "A", url: "https://a", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k" }).returning())[0]!.id;
  targetId = (await db.insert(backupTargets).values({ name: "s3", endpoint: "http://s3:9000", bucket: "bk", prefix: "ic", accessKeyId: "AK", secretKeyEnc: seal(KEY, "SK") }).returning())[0]!.id;
});

function run(o: StubBackups = {}, payload: Record<string, unknown> = {}, signal = new AbortController().signal, directWaitMs = 2000) {
  const a = stubCluster("A", { web: { status: "Running", type: "container", config: {} } }, log, o);
  const ctx = {
    db,
    secretKey: KEY,
    job: { id: "00000000-0000-4000-8000-000000000001", tenantId: null, actorType: "user", actorId: "u1", payload: { clusterId, project: "acme", instanceName: "web", targetId, instanceOnly: false, transport: "auto", ...payload } },
    signal,
    progress: async () => {},
    clientFor: async () => ({ client: a, row: { id: clusterId, name: "A" } }),
  } as unknown as JobContext;
  return { a, result: backupHandler({ storeFor: () => store, directWaitMs })(ctx) as Promise<{ backupId: string; transport: string; sizeBytes: number | null; pruned: number }> };
}
const rows = () => db.select().from(backups);

test("relay: the export streams into the target; the row is ready with its size; the cluster backup goes", async () => {
  const { a, result } = run();
  const r = await result;
  expect(r).toMatchObject({ transport: "relay", sizeBytes: 300_000 });
  const [b] = await rows();
  expect(b).toMatchObject({ id: r.backupId, state: "ready", sizeBytes: 300_000, transport: "relay", instanceType: "container", createdBy: "user:u1", project: "acme", instanceName: "web" });
  expect(b!.objectKey).toMatch(/^ic\/acme\/web\/\d{8}T\d{6}Z-[0-9a-f]{8}\.tar\.gz$/);
  expect(store.keys()).toEqual([b!.objectKey]);
  expect(log).toEqual(["A backup web", "A export web", "A delete-backup web"]);
  expect(a.bodies[0]).toMatchObject({ instance_only: false, optimized_storage: false, compression_algorithm: "gzip" });
  expect(new Date((a.bodies[0] as { expires_at: string }).expires_at).getTime()).toBeGreaterThan(Date.now() + 3600_000);
  expect(a.backups.size).toBe(0);
});

test("relay with direct_backup: the backup streams straight from the cluster, nothing is stored there", async () => {
  const { a, result } = run({ extensions: ["direct_backup"] }, { transport: "relay" });
  expect(await result).toMatchObject({ transport: "relay", sizeBytes: 300_000 });
  expect(log).toEqual(["A backup-stream web"]);
  expect(a.bodies[0]).toEqual({ instance_only: false, optimized_storage: false, compression_algorithm: "gzip" });
  expect(store.keys().length).toBe(1);
});

test("direct: the cluster uploads with the target's bucket, key and opened secret; the size comes from the store", async () => {
  const { a, result } = run({
    extensions: ["backup_s3_upload"],
    onDirect: async (t) => void (await store.put(t.path!, new Blob([new Uint8Array(1234)]).stream())),
  });
  const r = await result;
  expect(r).toMatchObject({ transport: "direct", sizeBytes: 1234 });
  const [b] = await rows();
  // Incus refuses a name with a target.
  expect((a.bodies[0] as { name?: string }).name).toBeUndefined();
  expect((a.bodies[0] as { target: unknown }).target).toEqual({ protocol: "s3", url: "http://s3:9000", bucket_name: "bk", path: b!.objectKey, access_key: "AK", secret_key: "SK" });
  expect(log).toEqual(["A backup web direct"]);
});

test("direct: an upload the cluster reports done early is waited for", async () => {
  const { result } = run({ extensions: ["backup_s3_upload"], directLagMs: 300, onDirect: async (t) => void (await store.put(t.path!, new Blob([new Uint8Array(77)]).stream())) }, { transport: "direct" });
  expect(await result).toMatchObject({ transport: "direct", sizeBytes: 77 });
});

test("direct: an object that never appears fails the backup; auto relays instead", async () => {
  const never = { extensions: ["backup_s3_upload"], directLagMs: 60_000 };
  expect(await run(never, { transport: "direct" }, undefined, 200).result.catch((e) => (e as Error).message)).toBe("The cluster reported the upload done, but the object is not in the target");
  log.length = 0;
  expect((await run(never, {}, undefined, 200).result).transport).toBe("relay");
});

test("auto: a failed direct upload falls back to relay", async () => {
  const { result } = run({ extensions: ["backup_s3_upload"], directFails: "dial tcp s3:9000: no route to host" });
  expect((await result).transport).toBe("relay");
  expect(log).toEqual(["A backup web direct", "A backup web", "A export web", "A delete-backup web"]);
  expect((await rows())[0]!.state).toBe("ready");
});

test("the region Incus signs its uploads for: an AWS endpoint's own, else us-east-1 (s3util.RegionFromURL)", () => {
  const cases: Record<string, string> = {
    "https://s3.amazonaws.com": "us-east-1",
    "https://s3.eu-central-1.amazonaws.com": "eu-central-1",
    "https://s3-eu-west-1.amazonaws.com": "eu-west-1",
    "https://bk.s3.ap-south-1.amazonaws.com:443": "ap-south-1",
    "https://s3.dualstack.us-west-2.amazonaws.com": "us-west-2",
    "https://bk.s3-us-east-2.amazonaws.com": "us-east-2",
    "http://garage:3900": "us-east-1",
    "https://minio.example": "us-east-1",
    "not a url": "us-east-1",
  };
  for (const [url, region] of Object.entries(cases)) expect(incusUploadRegion(url), url).toBe(region);
});

test("an AWS target in its endpoint's region is uploaded directly", async () => {
  await db.update(backupTargets).set({ endpoint: "https://s3.eu-central-1.amazonaws.com", region: "eu-central-1" });
  const r = await run({ extensions: ["backup_s3_upload"], onDirect: async (t) => void (await store.put(t.path!, new Blob([new Uint8Array(5)]).stream())) }).result;
  expect(r).toMatchObject({ transport: "direct", sizeBytes: 5 });
});

test("a target outside the region Incus signs for (a Garage store's own region) always relays", async () => {
  await db.update(backupTargets).set({ region: "garage" });
  const o = { extensions: ["backup_s3_upload"], directFails: "AuthorizationHeaderMalformed: unexpected scope" };
  expect(await run(o, { transport: "direct" }).result.catch((e) => (e as Error).message)).toBe("The cluster cannot upload to this target itself: Incus signs its uploads to this endpoint for region us-east-1, and the target is in garage");
  log.length = 0;
  expect((await run(o).result).transport).toBe("relay");
  expect(log.some((l) => l.endsWith(" direct"))).toBe(false); // no doomed attempt first
});

test("direct without the extension is refused; auto without it relays", async () => {
  expect(await run({}, { transport: "direct" }).result.catch((e) => (e as Error).message)).toMatch(/cannot upload backups itself/);
  log.length = 0;
  expect((await run().result).transport).toBe("relay");
});

test("a cluster error fails the row, leaves no object and removes the cluster backup; the policy records it", async () => {
  const policyId = (await db.insert(backupPolicies).values({ clusterId, project: "acme", instanceName: "web", targetId, createdBy: "u" }).returning())[0]!.id;
  const { a, result } = run({ exportFails: "disk I/O error" }, { policyId });
  expect(await result.catch((e) => (e as Error).message)).toBe("Cluster: disk I/O error");
  expect((await rows())[0]).toMatchObject({ state: "failed", error: "Cluster: disk I/O error", policyId });
  expect(store.keys()).toEqual([]);
  expect(a.backups.size).toBe(0);
  expect((await db.select().from(backupPolicies))[0]!.lastError).toBe("Cluster: disk I/O error");
});

test("cancel mid-export: no object, the row fails as cancelled", async () => {
  const ac = new AbortController();
  const endless = (signal?: AbortSignal) =>
    new ReadableStream<Uint8Array>({
      async pull(c) {
        await Bun.sleep(2);
        if (signal?.aborted) return c.error(signal.reason);
        c.enqueue(new Uint8Array(10_000));
      },
    });
  const { a, result } = run({ exportStream: endless }, {}, ac.signal);
  setTimeout(() => ac.abort(new Error("Cancelled")), 40);
  expect(await result.catch((e) => (e as Error).message)).toBe("Cancelled");
  expect((await rows())[0]).toMatchObject({ state: "failed", error: "Cancelled" });
  expect(store.keys()).toEqual([]);
  expect(a.backups.size).toBe(0);
});

test("retention keeps the policy's newest ready backups; manual, failed and other policies' backups stay", async () => {
  const mkPolicy = async (keep: number, project = "acme") => (await db.insert(backupPolicies).values({ clusterId, project, instanceName: "web", targetId, keep, createdBy: "u" }).returning())[0]!.id;
  const policyId = await mkPolicy(2);
  const other = await mkPolicy(1, "beta");
  const old = async (key: string, o: { policyId?: string | null; state?: "ready" | "failed"; daysAgo: number }) => {
    await store.put(key, new Blob(["x"]).stream());
    await db.insert(backups).values({ objectKey: key, targetId, clusterId, project: "acme", instanceName: "web", state: o.state ?? "ready", policyId: o.policyId ?? null, createdBy: "u", createdAt: new Date(Date.now() - o.daysAgo * 86400_000) });
  };
  await old("p1", { policyId, daysAgo: 3 });
  await old("p2", { policyId, daysAgo: 2 });
  await old("p3", { policyId, daysAgo: 1 });
  await old("pf", { policyId, state: "failed", daysAgo: 4 });
  await old("manual", { daysAgo: 9 });
  await old("other", { policyId: other, daysAgo: 9 });
  const r = await run({}, { policyId }).result;
  expect(r.pruned).toBe(2);
  const left = (await rows()).map((b) => b.objectKey).sort();
  expect(left).toContain("p3");
  expect(left).not.toContain("p1");
  expect(left).not.toContain("p2");
  expect(left).toEqual(expect.arrayContaining(["pf", "manual", "other"]));
  // Rows and objects agree: what was pruned is gone from both.
  expect(store.keys().sort()).toEqual(left);
  expect((await db.select().from(backupPolicies).where(eq(backupPolicies.id, policyId)))[0]).toMatchObject({ lastError: "" });
});

test("a failed run prunes nothing", async () => {
  const policyId = (await db.insert(backupPolicies).values({ clusterId, project: "acme", instanceName: "web", targetId, keep: 1, createdBy: "u" }).returning())[0]!.id;
  await store.put("k1", new Blob(["x"]).stream());
  await db.insert(backups).values({ objectKey: "k1", targetId, clusterId, project: "acme", instanceName: "web", state: "ready", policyId, createdBy: "u", createdAt: new Date(Date.now() - 86400_000) });
  await run({ backupFails: "no space" }, { policyId }).result.catch(() => {});
  expect(store.keys()).toContain("k1");
});

test("the scheduler queues due policies, skipping busy instances, disabled and not-yet-due ones", async () => {
  const mk = (project: string, over: Partial<typeof backupPolicies.$inferInsert> = {}) => db.insert(backupPolicies).values({ clusterId, project, instanceName: "web", targetId, createdBy: "u", ...over }).returning();
  const [due] = await mk("acme");
  await mk("off", { enabled: false });
  await mk("recent", { lastRunAt: new Date(Date.now() - 60_000) });
  const [busy] = await mk("busy");
  await enqueueJob(db, { type: "migrate", payload: {}, actor: { type: "user", id: "u" }, instanceKey: `${clusterId}/busy/web` });
  await scheduleBackups(db);
  const queued = (await db.select().from(jobs).where(eq(jobs.type, "backup"))).map((j) => j.payload as { project: string; policyId: string; transport: string });
  expect(queued).toEqual([expect.objectContaining({ project: "acme", policyId: due!.id, transport: "auto" })]);
  expect((await db.select().from(backupPolicies).where(eq(backupPolicies.id, due!.id)))[0]!.lastJobId).not.toBeNull();
  expect((await db.select().from(backupPolicies).where(eq(backupPolicies.id, busy!.id)))[0]!.lastJobId).toBeNull();
  await scheduleBackups(db);
  expect((await db.select().from(jobs).where(eq(jobs.type, "backup"))).length).toBe(1);
});
