import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { backups, backupTargets, clusters } from "../db/schema.ts";
import type { JobContext } from "../jobs/types.ts";
import { stubCluster, type StubBackups } from "../test/stub-cluster.ts";
import { restoreHandler, TAG_RESTORED_FROM } from "./restore-job.ts";
import { memoryStore } from "./store.ts";
import type { SourceInstance, TargetFacts } from "../mobility/preflight.ts";
import type { TransferOptions } from "../mobility/transfer.ts";

let db: Db;
let log: string[];
let clusterId: string;
let backupId: string;
let store: ReturnType<typeof memoryStore>;

beforeEach(async () => {
  db = await testDb();
  log = [];
  store = memoryStore();
  clusterId = (await db.insert(clusters).values({ name: "B", url: "https://b", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k" }).returning())[0]!.id;
  const targetId = (await db.insert(backupTargets).values({ name: "s3", endpoint: "http://s3", bucket: "bk", accessKeyId: "AK", secretKeyEnc: "x" }).returning())[0]!.id;
  backupId = (await db.insert(backups).values({ objectKey: "acme/web/1.tar.gz", targetId, project: "acme", instanceName: "web", state: "ready", createdBy: "u" }).returning())[0]!.id;
  await store.put("acme/web/1.tar.gz", new Blob([new Uint8Array(4321)]).stream());
  transferFails = undefined;
  targetFacts = target();
});

const restricted = { projectConfig: { acme: { restricted: "true" } } };

test("into a restricted project: imported into the staging project, migrated in, the staged copy removed", async () => {
  const { b, result } = run({ start: true }, restricted);
  expect(await result).toEqual({ targetClusterId: clusterId, targetProject: "acme", targetName: "web2" });
  expect(log).toEqual(["B create-project incuscloud-restore", "B import r-job-1 4321 pool=fast", "B migrate incuscloud-restore/r-job-1 → acme/web2", "B delete r-job-1", "B start web2"]);
  expect(b.bodies.find((x) => (x as { name?: string }).name === "incuscloud-restore")).toMatchObject({ config: { "features.profiles": "false", "user.incuscloud.internal": "restore staging" } });
  expect(transfers[0]).toMatchObject({ srcProject: "incuscloud-restore", dstProject: "acme", name: "r-job-1", refresh: false, live: false });
  expect(transfers[0]!.request.config).toMatchObject({ [TAG_RESTORED_FROM]: backupId });
  expect(b.instances.web2!.config[TAG_RESTORED_FROM]).toBe(backupId);
  expect(b.instances["r-job-1"]).toBeUndefined();
});

test("into a restricted project: a pre-flight problem or a failed migration still removes the staged copy", async () => {
  targetFacts = target({ architectures: ["x86_64"] });
  expect(await msg(run({}, restricted).result)).toMatch(/no aarch64 members/);
  expect(log.at(-1)).toBe("B delete r-job-1");
  log.length = 0;
  targetFacts = target();
  transferFails = "Target: disk full";
  expect(await msg(run({}, { ...restricted, projects: ["acme", "incuscloud-restore"] }).result)).toBe("Target: disk full");
  expect(log).toEqual(["B import r-job-1 4321 pool=fast", "B migrate incuscloud-restore/r-job-1 → acme/web2", "B delete r-job-1"]);
});

const source = (): SourceInstance => ({ name: "r-job-1", type: "container", status: "Stopped", architecture: "aarch64", config: { "volatile.idmap.base": "0" }, devices: {}, profiles: ["default"], expandedDevices: { root: { type: "disk", path: "/", pool: "fast" } }, snapshots: 0, apiExtensions: [] });
const target = (o: Partial<TargetFacts> = {}): TargetFacts => ({ projectExists: true, architectures: ["aarch64"], pools: ["fast"], networks: [], profiles: ["default"], instanceNames: [], defaultProfileDevices: { root: { type: "disk", path: "/", pool: "fast" } }, apiExtensions: [], ...o });
let transfers: TransferOptions[];
let transferFails: string | undefined;
let targetFacts: TargetFacts;

function run(payload: Record<string, unknown> = {}, o: StubBackups & { existing?: string[] } = {}, signal = new AbortController().signal) {
  const b = stubCluster("B", Object.fromEntries((o.existing ?? []).map((n) => [n, { status: "Running", type: "container", config: {} }])), log, o);
  transfers = [];
  const deps = {
    storeFor: () => store,
    sourceFacts: async () => source(),
    targetFacts: async () => targetFacts,
    transfer: async (t: TransferOptions) => {
      transfers.push(t);
      log.push(`B migrate ${t.srcProject}/${t.name} → ${t.dstProject}/${t.request.name}`);
      if (transferFails) throw new Error(transferFails);
      b.instances[t.request.name] = { status: "Stopped", type: "container", config: t.request.config };
      return { transport: "direct" as const };
    },
  };
  const ctx = {
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "job-1", payload: { backupId, targetClusterId: clusterId, targetProject: "acme", targetName: "web2", start: false, ...payload } },
    signal,
    progress: async () => {},
    clientFor: async () => ({ client: b, row: { id: clusterId, name: "B" } }),
  } as unknown as JobContext;
  return { b, result: restoreHandler(deps)(ctx) };
}
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as Error).message);

test("the object streams into an import named and pooled as asked; the instance is tagged and started", async () => {
  const { b, result } = run({ pool: "fast", start: true });
  expect(await result).toEqual({ targetClusterId: clusterId, targetProject: "acme", targetName: "web2" });
  expect(log).toEqual(["B import web2 4321 pool=fast", "B patch web2", "B start web2"]);
  expect(b.instances.web2!.config[TAG_RESTORED_FROM]).toBe(backupId);
});

test("not started unless asked", async () => {
  await run().result;
  expect(log).toEqual(["B import web2 4321", "B patch web2"]);
});

test("an existing instance of that name is never overwritten: refused before any upload", async () => {
  expect(await msg(run({}, { existing: ["web2"] }).result)).toBe('An instance named "web2" already exists in acme on the target; it is not overwritten');
  expect(log).toEqual([]);
});

test("a project missing on the target is a clear error", async () => {
  expect(await msg(run({ targetProject: "zzz" }).result)).toBe('Project "zzz" does not exist on the target cluster');
});

test("an object deleted outside IncusCloud fails clearly", async () => {
  await store.delete("acme/web/1.tar.gz");
  expect(await msg(run().result)).toBe("The backup is not in its target any more (acme/web/1.tar.gz)");
});

test("only a ready backup can be restored", async () => {
  await db.update(backups).set({ state: "creating" });
  expect(await msg(run().result)).toBe("Only a ready backup can be restored (this one is creating)");
});

test("an import Incus refuses fails the job with its message", async () => {
  expect(await msg(run({}, { importFails: "Instance type not allowed in restricted project" }).result)).toBe("Cluster: Instance type not allowed in restricted project");
});

test("cancelled during the upload", async () => {
  const ac = new AbortController();
  ac.abort(new Error("Cancelled"));
  expect(await msg(run({}, {}, ac.signal).result)).toBe("Cancelled");
});
