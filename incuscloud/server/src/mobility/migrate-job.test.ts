import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, instanceOwners, users } from "../db/schema.ts";
import { stubCluster, type StubInstance } from "../test/stub-cluster.ts";
import type { JobContext } from "../jobs/types.ts";
import type { SourceInstance, TargetFacts } from "./preflight.ts";
import { ownerOf, recordOwner } from "../acl/owners.ts";
import { migrateHandler, type MigratePayload } from "./migrate-job.ts";

let db: Db;
let log: string[];
let ids: { a: string; b: string };

const cluster = (label: string, instances: Record<string, StubInstance>) => stubCluster(label, instances, log);

const source = (status = "Running", type: "container" | "virtual-machine" = "container"): SourceInstance => ({
  name: "web",
  type,
  status,
  architecture: "aarch64",
  config: { "volatile.uuid": "u" },
  devices: {},
  profiles: ["default"],
  expandedDevices: { root: { type: "disk", path: "/", pool: "p" } },
  snapshots: 0,
  apiExtensions: [],
});
const target = (over: Partial<TargetFacts> = {}): TargetFacts => ({ projectExists: true, architectures: ["aarch64"], pools: ["default"], networks: [], profiles: ["default"], instanceNames: [], defaultProfileDevices: {}, apiExtensions: [], ...over });

function setup(o: { actor?: string; status?: string; mode?: "copy" | "move"; target?: Partial<TargetFacts>; transfer?: (dst: ReturnType<typeof cluster>, request: { name: string; config: Record<string, string> }) => Promise<void>; abort?: boolean }) {
  const a = cluster("A", { web: { status: o.status ?? "Running", type: "container", config: {} } });
  const b = cluster("B", {});
  const abort = new AbortController();
  const payload: MigratePayload = { sourceClusterId: ids.a, sourceProject: "acme", name: "web", targetClusterId: ids.b, targetProject: "acme", targetName: "web", mode: o.mode ?? "move", live: false, transport: "auto" };
  const handler = migrateHandler({
    sourceFacts: async () => source(o.status ?? "Running"),
    targetFacts: async () => target(o.target),
    transfer: async (t) => {
      log.push(`transfer ${t.transport}`);
      if (o.abort) abort.abort(new Error("Cancelled"));
      if (o.transfer) await o.transfer(b, t.request);
      else b.instances[t.request.name] = { status: "Stopped", type: t.request.type, config: t.request.config };
      if (o.abort) throw abort.signal.reason;
      return { transport: "direct" as const };
    },
  });
  const ctx = {
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "job-1", payload, actorType: o.actor ? "user" : "system", actorId: o.actor ?? "scheduler" },
    signal: abort.signal,
    progress: async () => {},
    clientFor: async (id: string) => ({ client: id === ids.a ? a : b, row: { id, name: id === ids.a ? "A" : "B", serverCert: "PEM", url: id === ids.a ? a.url : b.url } }),
  } as unknown as JobContext;
  return { a, b, run: () => handler(ctx) };
}

beforeEach(async () => {
  db = await testDb();
  log = [];
  const mk = async (name: string) => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k", inventoryAt: new Date() }).returning())[0]!.id;
  ids = { a: await mk("A"), b: await mk("B") };
});

test("move: stop, transfer, delete the source, start the target; inventories refreshed", async () => {
  const { a, b, run } = setup({});
  expect(await run()).toEqual({ transport: "direct", targetClusterId: ids.b, targetProject: "acme", targetName: "web" });
  expect(log).toEqual(["A stop web", "transfer auto", "B start web", "A delete web"]);
  expect(a.instances.web).toBeUndefined();
  expect(b.instances.web!.status).toBe("Running");
  expect(b.instances.web!.config["user.incuscloud.migrated-from"]).toBe(`${ids.a}/acme/web`);
  // A move keeps the instance's identity, as `incus move` does.
  expect(b.instances.web!.config["volatile.uuid"]).toBe("u");
  expect((await db.select().from(clusters)).every((c) => c.inventoryAt === null)).toBe(true);
});

test("copy: the source keeps running and the copy is not started", async () => {
  const { a, b, run } = setup({ mode: "copy" });
  await run();
  expect(log).toEqual(["transfer auto"]);
  expect(a.instances.web!.status).toBe("Running");
  expect(b.instances.web!.status).toBe("Stopped");
});

test("a failed transfer removes the target this job created and restarts the source", async () => {
  const { a, b, run } = setup({
    transfer: async (dst, request) => {
      dst.instances[request.name] = { status: "Stopped", type: "container", config: request.config };
      throw new Error("Target: disk full");
    },
  });
  await expect(run()).rejects.toThrow("Target: disk full");
  expect(log).toEqual(["A stop web", "transfer auto", "B delete web", "A start web"]);
  expect(b.instances.web).toBeUndefined();
  expect(a.instances.web!.status).toBe("Running");
});

test("an instance on the target that this job did not create is never deleted", async () => {
  const { b, run } = setup({
    transfer: async (dst) => {
      dst.instances.web = { status: "Running", type: "container", config: { "user.incuscloud.job": "someone-else" } };
      throw new Error("Target: Instance name is already in use");
    },
  });
  await expect(run()).rejects.toThrow("already in use");
  expect(b.instances.web).toBeDefined();
  expect(log).not.toContain("B delete web");
});

test("a cancel during the transfer rolls back like a failure", async () => {
  const { a, b, run } = setup({ abort: true });
  await expect(run()).rejects.toThrow("Cancelled");
  expect(b.instances.web).toBeUndefined();
  expect(a.instances.web!.status).toBe("Running");
});

test("pre-flight is checked again when the job runs; problems stop it before anything changes", async () => {
  const { run } = setup({ target: { instanceNames: ["web"] } });
  await expect(run()).rejects.toThrow('An instance named "web" already exists on the target');
  expect(log).toEqual([]);
});

test("a move keeps the instance's owner; a copy belongs to whoever copied", async () => {
  const [owner] = await db.insert(users).values({ email: "own@x", name: "o" }).returning();
  const [mover] = await db.insert(users).values({ email: "mov@x", name: "m" }).returning();
  await recordOwner(db, { clusterId: ids.a, project: "acme", name: "web" }, `user:${owner!.id}`, "event");
  await setup({ actor: mover!.id }).run();
  expect(await ownerOf(db, { clusterId: ids.b, project: "acme", name: "web" })).toBe(`user:${owner!.id}`);
  expect(await ownerOf(db, { clusterId: ids.a, project: "acme", name: "web" })).toBeNull();
  await db.delete(instanceOwners);
  await recordOwner(db, { clusterId: ids.a, project: "acme", name: "web" }, `user:${owner!.id}`, "event");
  await setup({ actor: mover!.id, mode: "copy" }).run();
  expect(await ownerOf(db, { clusterId: ids.b, project: "acme", name: "web" })).toBe(`user:${mover!.id}`);
  expect(await ownerOf(db, { clusterId: ids.a, project: "acme", name: "web" })).toBe(`user:${owner!.id}`);
});
