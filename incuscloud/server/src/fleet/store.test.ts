import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { clusterMembers, clusters, instances, metricsSamples, networks, storagePools } from "../db/schema.ts";
import type { InstanceSnapshot, Snapshot } from "./collect.ts";
import { applySnapshot } from "./store.ts";

const HOUR = 3_600_000;
const t0 = new Date("2026-10-11T12:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);

const inst = (over: Partial<InstanceSnapshot> = {}): InstanceSnapshot => ({
  project: "acme",
  name: "web",
  type: "container",
  status: "Running",
  location: "n1",
  description: "Front End",
  architecture: "x86_64",
  createdAt: "2026-10-01T10:00:00Z",
  imageOs: "Ubuntu",
  imageRelease: "noble",
  limitsCpu: "2",
  limitsMemory: "1GiB",
  cpuNs: 10e9,
  memoryUsed: 100,
  memoryTotal: 1000,
  diskUsed: 4096,
  netRx: 1000,
  netTx: 2000,
  addresses: ["10.0.0.5"],
  ...over,
});
const snap = (instances: InstanceSnapshot[], over: Partial<Snapshot> = {}): Snapshot => ({
  clustered: false,
  members: [{ name: "n1", url: "", status: "Online", roles: [], architecture: "x86_64", cpuThreads: 8, memoryTotal: 8000, memoryUsed: 3000, load1: 0.25, uptimeS: 10 }],
  pools: [{ member: "n1", name: "local", driver: "dir", status: "Created", spaceTotal: 100, spaceUsed: 40 }],
  networks: [{ project: "default", name: "incusbr0", type: "bridge", managed: true, status: "Created", description: "" }],
  instances,
  ...over,
});

async function setup() {
  const db = await testDb();
  const [c] = await db.insert(clusters).values({ name: "Lab", url: "https://h:8443", fingerprint: "ab", serverCert: "pem", clientCert: "pem", clientKeyEnc: "v1.x.y", inventoryError: "old error" }).returning();
  return { db, id: c!.id };
}

test("first pass: rows written, no rates yet, the cluster marked synced", async () => {
  const { db, id } = await setup();
  expect(await applySnapshot(db, id, "Lab", snap([inst()]), t0, 24 * HOUR)).toEqual({ instances: 1 });
  const [i] = await db.select().from(instances);
  expect(i).toMatchObject({ project: "acme", name: "web", cpuNs: 10e9, cpuCores: null, netRxBps: null, addresses: ["10.0.0.5"], seenAt: t0 });
  expect(i!.search).toBe("web acme lab n1 front end ubuntu noble container running 10.0.0.5");
  const [c] = await db.select().from(clusters);
  expect(c).toMatchObject({ inventoryAt: t0, inventoryError: "" });
  expect(await db.select().from(clusterMembers)).toHaveLength(1);
  expect(await db.select().from(storagePools)).toHaveLength(1);
  expect(await db.select().from(networks)).toHaveLength(1);
  const samples = await db.select().from(metricsSamples);
  expect(samples.map((s) => [s.kind, s.ref, s.cpuCores, s.memoryUsed, s.load1])).toEqual([
    ["instance", i!.id, null, 100, null],
    ["member", "n1", null, 3000, 0.25],
  ]);
});

test("second pass: CPU in cores and network in bytes per second since the last pass", async () => {
  const { db, id } = await setup();
  await applySnapshot(db, id, "Lab", snap([inst()]), t0, 24 * HOUR);
  const [before] = await db.select().from(instances);
  await applySnapshot(db, id, "Lab", snap([inst({ cpuNs: 40e9, netRx: 7000, netTx: 2600 })]), at(60), 24 * HOUR);
  const [i] = await db.select().from(instances);
  expect(i!.id).toBe(before!.id);
  expect(i!.cpuCores).toBeCloseTo(0.5);
  expect(i!.netRxBps).toBeCloseTo(100);
  expect(i!.netTxBps).toBeCloseTo(10);
  const last = (await db.select().from(metricsSamples).where(eq(metricsSamples.ref, i!.id))).at(-1);
  expect(last!.cpuCores).toBeCloseTo(0.5);
});

test("a counter that went backwards (restart) gives no rate", async () => {
  const { db, id } = await setup();
  await applySnapshot(db, id, "Lab", snap([inst()]), t0, 24 * HOUR);
  await applySnapshot(db, id, "Lab", snap([inst({ cpuNs: 1e9, netRx: 10 })]), at(60), 24 * HOUR);
  const [i] = await db.select().from(instances);
  expect(i).toMatchObject({ cpuNs: 1e9, cpuCores: null, netRxBps: null });
});

test("stopped instances have no sample; vanished instances, members, pools and networks go", async () => {
  const { db, id } = await setup();
  await applySnapshot(db, id, "Lab", snap([inst(), inst({ name: "db" })]), t0, 24 * HOUR);
  await applySnapshot(db, id, "Lab", snap([inst({ status: "Stopped", cpuNs: null, memoryUsed: null, netRx: null, netTx: null })], { members: [], pools: [], networks: [] }), at(60), 24 * HOUR);
  const rows = await db.select().from(instances);
  expect(rows.map((r) => [r.name, r.status, r.cpuCores])).toEqual([["web", "Stopped", null]]);
  expect(await db.select().from(clusterMembers)).toEqual([]);
  expect(await db.select().from(storagePools)).toEqual([]);
  expect(await db.select().from(networks)).toEqual([]);
  expect((await db.select().from(metricsSamples)).filter((s) => s.at.getTime() === at(60).getTime())).toEqual([]);
});

test("an instance moved to another project is one row, not two", async () => {
  const { db, id } = await setup();
  await applySnapshot(db, id, "Lab", snap([inst()]), t0, 24 * HOUR);
  await applySnapshot(db, id, "Lab", snap([inst({ project: "other" })]), at(60), 24 * HOUR);
  expect((await db.select().from(instances)).map((r) => r.project)).toEqual(["other"]);
});

test("samples older than the retention are pruned; other clusters are untouched", async () => {
  const { db, id } = await setup();
  const [other] = await db.insert(clusters).values({ name: "other", url: "https://o:8443", fingerprint: "cd", serverCert: "pem", clientCert: "pem", clientKeyEnc: "v1.x.y" }).returning();
  await applySnapshot(db, other!.id, "other", snap([inst()]), at(3 * 3600), 24 * HOUR);
  await applySnapshot(db, id, "Lab", snap([inst()]), t0, 2 * HOUR);
  await applySnapshot(db, id, "Lab", snap([inst()]), at(3 * 3600), 2 * HOUR);
  const left = await db.select().from(metricsSamples);
  expect(left.every((s) => s.at.getTime() === at(3 * 3600).getTime())).toBe(true);
  expect((await db.select().from(instances)).length).toBe(2);
});
