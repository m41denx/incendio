import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { backups, backupTargets, clusters } from "../db/schema.ts";
import type { JobContext } from "../jobs/types.ts";
import { stubCluster, type StubBackups } from "../test/stub-cluster.ts";
import { restoreHandler, TAG_RESTORED_FROM } from "./restore-job.ts";
import { memoryStore } from "./store.ts";

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
});

function run(payload: Record<string, unknown> = {}, o: StubBackups & { existing?: string[] } = {}, signal = new AbortController().signal) {
  const b = stubCluster("B", Object.fromEntries((o.existing ?? []).map((n) => [n, { status: "Running", type: "container", config: {} }])), log, o);
  const ctx = {
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "job-1", payload: { backupId, targetClusterId: clusterId, targetProject: "acme", targetName: "web2", start: false, ...payload } },
    signal,
    progress: async () => {},
    clientFor: async () => ({ client: b, row: { id: clusterId, name: "B" } }),
  } as unknown as JobContext;
  return { b, result: restoreHandler({ storeFor: () => store })(ctx) };
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
