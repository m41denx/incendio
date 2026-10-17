import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, instances, leases, placements, tenantMembers, tenants, users } from "../db/schema.ts";
import { ownerOf } from "../acl/owners.ts";
import { acquireLease } from "../reconcile/lease.ts";
import type { Snapshot } from "./collect.ts";
import { FleetWorker } from "./worker.ts";

let db: Db;
let seen: string[];
let fail: Set<string>;
const one = (name: string): Snapshot => ({
  clustered: false,
  members: [],
  pools: [],
  networks: [],
  instances: [{ project: "default", name, type: "container", status: "Stopped", location: "", description: "", architecture: "", createdAt: "", imageOs: "", imageRelease: "", limitsCpu: "", limitsMemory: "", cpuNs: null, memoryUsed: null, memoryTotal: null, diskUsed: null, netRx: null, netTx: null, addresses: [], hints: {}, stateful: false }],
});
const collect = async (row: { name: string }) => {
  seen.push(row.name);
  if (fail.has(row.name)) throw new Error(`${row.name} is down`);
  return one(`${row.name}-vm`);
};
const worker = (holder = "w1") => new FleetWorker({ db, secretKey: Buffer.alloc(32) }, { holder, intervalMs: 60_000, retentionMs: 3_600_000, collect });
const cluster = async (name: string, status = "ready") => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k", status }).returning())[0]!.id;

beforeEach(async () => {
  db = await testDb();
  seen = [];
  fail = new Set();
  await cluster("c1");
  await cluster("c2", "pending");
  await cluster("off", "disabled");
});

test("due clusters are collected and stored; disabled ones are not; then nothing is due", async () => {
  const w = worker();
  await w.tick();
  expect(seen.sort()).toEqual(["c1", "c2"]);
  expect((await db.select().from(instances)).map((i) => i.name).sort()).toEqual(["c1-vm", "c2-vm"]);
  seen = [];
  await w.tick();
  expect(seen).toEqual([]);
});

test("a stale inventory is collected again", async () => {
  const w = worker();
  await w.tick();
  seen = [];
  await db.update(clusters).set({ inventoryAt: new Date(Date.now() - 61_000) }).where(eq(clusters.name, "c2"));
  await w.tick();
  expect(seen).toEqual(["c2"]);
});

test("a failing cluster records its error, keeps its last inventory and waits for the next interval", async () => {
  const w = worker();
  await w.tick();
  await db.update(clusters).set({ inventoryAt: null });
  fail.add("c1");
  seen = [];
  await w.tick();
  expect(seen.sort()).toEqual(["c1", "c2"]);
  const [c1] = await db.select().from(clusters).where(eq(clusters.name, "c1"));
  expect(c1!.inventoryError).toBe("c1 is down");
  expect(c1!.inventoryAt).not.toBeNull();
  expect((await db.select().from(instances)).map((i) => i.name).sort()).toEqual(["c1-vm", "c2-vm"]);
  seen = [];
  await w.tick();
  expect(seen).toEqual([]);
});

test("without the lease nothing is collected; stop releases it", async () => {
  expect(await acquireLease(db, "inventory", "other", 30_000)).toBe(true);
  await worker().tick();
  expect(seen).toEqual([]);
  await db.delete(leases);
  const w = worker();
  w.start();
  for (let i = 0; i < 50 && seen.length < 2; i++) await Bun.sleep(10);
  await w.stop();
  expect(seen.sort()).toEqual(["c1", "c2"]);
  expect(await db.select().from(leases)).toEqual([]);
});

test("after a pass, instances nobody claimed go to their tenant's first owner, and the cluster is reconciled", async () => {
  const [c1] = await db.select().from(clusters).where(eq(clusters.name, "c1"));
  const [t] = await db.insert(tenants).values({ slug: "default", name: "D" }).returning();
  await db.insert(placements).values({ tenantId: t!.id, clusterId: c1!.id, project: "default" });
  const [u] = await db.insert(users).values({ email: "o@x", name: "o" }).returning();
  await db.insert(tenantMembers).values({ tenantId: t!.id, userId: u!.id, role: "owner" });
  await worker().tick();
  expect(await ownerOf(db, { clusterId: c1!.id, project: "default", name: "c1-vm" })).toBe(`user:${u!.id}`);
  const [after] = await db.select().from(clusters).where(eq(clusters.id, c1!.id));
  expect(after!.reconcileRequestedAt).not.toBeNull();
});
