import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, instanceLeases, instances, jobs, placements, tenants, type LeasePolicy } from "../db/schema.ts";
import type { JobContext } from "../jobs/types.ts";
import { stubCluster, type StubInstance } from "../test/stub-cluster.ts";
import { dropTenantLeases, extendLease, leaseHandler, leaseOf, putLease, renameLease, scheduleLeases, setLease, tenantLeases, type LeasePayload } from "./leases.ts";

const DAY = 86400_000;
const STOP: LeasePolicy = { days: 30, action: "stop", extendDays: 7, maxExtensions: 2 };
let db: Db;
let lab: string;
let acme: string;
let globex: string;
const key = (name: string, project = "acme") => ({ clusterId: lab, project, name });

beforeEach(async () => {
  db = await testDb();
  lab = (await db.insert(clusters).values({ name: "lab", url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
  acme = (await db.insert(tenants).values({ slug: "acme", name: "Acme", leasePolicy: STOP }).returning())[0]!.id;
  globex = (await db.insert(tenants).values({ slug: "globex", name: "Globex" }).returning())[0]!.id;
  await db.insert(placements).values([
    { tenantId: acme, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: globex, clusterId: lab, project: "globex", status: "ready" },
  ]);
});

const inventory = (name: string, project = "acme", status = "Running") => db.insert(instances).values({ clusterId: lab, project, name, type: "container", status, search: name });
const leaseJobs = async () => (await db.select().from(jobs).where(eq(jobs.type, "lease"))).map((j) => j.payload as unknown as LeasePayload);

test("the scheduler hands each instance of a tenant with a policy one lease, and none to others", async () => {
  await inventory("web");
  await inventory("db", "globex");
  const now = new Date("2026-10-01T00:00:00Z");
  await scheduleLeases(db, now);
  expect((await leaseOf(db, key("web")))?.expiresAt?.getTime()).toBe(now.getTime() + 30 * DAY);
  expect(await leaseOf(db, key("db", "globex"))).toBeUndefined();
  // Again later: the lease stays as it was.
  await scheduleLeases(db, new Date(now.getTime() + DAY));
  expect((await leaseOf(db, key("web")))?.expiresAt?.getTime()).toBe(now.getTime() + 30 * DAY);
});

test("an ended stop lease queues one job while the instance runs, and again only once the inventory saw it since", async () => {
  await inventory("web");
  await inventory("idle", "acme", "Stopped");
  await setLease(db, key("web"), acme, new Date(Date.now() - DAY));
  await setLease(db, key("idle"), acme, new Date(Date.now() - DAY));
  await scheduleLeases(db);
  expect(await leaseJobs()).toEqual([{ clusterId: lab, project: "acme", name: "web", action: "stop" }]);
  const acted = (await leaseOf(db, key("web")))!.actedAt!;
  expect(acted).toBeInstanceOf(Date);

  await db.update(jobs).set({ state: "succeeded" });
  await scheduleLeases(db, new Date(acted.getTime() + 1000));
  expect((await leaseJobs()).length).toBe(1);
  // Started again by someone and seen running: stopped again.
  await db.update(instances).set({ seenAt: new Date(acted.getTime() + 2000) }).where(eq(instances.name, "web"));
  await scheduleLeases(db, new Date(acted.getTime() + 3000));
  expect((await leaseJobs()).length).toBe(2);
});

test("an ended delete lease queues a job whatever the instance's state; a busy instance waits", async () => {
  await db.update(tenants).set({ leasePolicy: { ...STOP, action: "delete" } }).where(eq(tenants.id, acme));
  await inventory("idle", "acme", "Stopped");
  await inventory("busy");
  await setLease(db, key("idle"), acme, new Date(Date.now() - DAY));
  await setLease(db, key("busy"), acme, new Date(Date.now() - DAY));
  await db.insert(jobs).values({ type: "migrate", payload: {}, actorType: "system", actorId: "x", instanceKey: `${lab}/acme/busy` });
  await scheduleLeases(db);
  expect(await leaseJobs()).toEqual([{ clusterId: lab, project: "acme", name: "idle", action: "delete" }]);
  // The busy one gets no actedAt, so the next pass tries again.
  expect((await leaseOf(db, key("busy")))!.actedAt).toBeNull();
});

test("extending: from the later of now and the end, as often as the policy allows; a never-ending lease can't be", async () => {
  await inventory("web");
  const end = new Date(Date.now() + 3 * DAY);
  await setLease(db, key("web"), acme, end);
  expect((await extendLease(db, key("web"), STOP)).expiresAt!.getTime()).toBe(end.getTime() + 7 * DAY);
  // Already ended: from now.
  await db.update(instanceLeases).set({ expiresAt: new Date(Date.now() - DAY) });
  const before = Date.now();
  const r = await extendLease(db, key("web"), STOP);
  expect(r.extensions).toBe(2);
  expect(r.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY);
  await expect(extendLease(db, key("web"), STOP)).rejects.toThrow("No extensions left: the tenant allows 2");
  await setLease(db, key("web"), acme, null);
  await expect(extendLease(db, key("web"), { ...STOP, maxExtensions: 9 })).rejects.toThrow("never ends");
  await expect(extendLease(db, key("gone"), STOP)).rejects.toThrow("no lease");
});

test("setting a lease makes it the given tenant's, and the writers take only the key from an inventory row", async () => {
  await setLease(db, key("web"), acme, new Date("2027-01-01T00:00:00Z"));
  // The project went to another tenant since; the platform sets the end again.
  const row = { ...key("web"), id: "row", createdAt: null };
  expect(await setLease(db, row, globex, null)).toMatchObject({ tenantId: globex, expiresAt: null });
  await renameLease(db, key("web"), { ...key("web2"), createdAt: null } as ReturnType<typeof key>);
  expect(await leaseOf(db, key("web2"))).toMatchObject({ tenantId: globex });
});

test("a moved instance keeps its lease within its tenant, not into another tenant's project", async () => {
  await setLease(db, key("web"), acme, new Date("2027-01-01T00:00:00Z"));
  await db.update(instanceLeases).set({ extensions: 1 });
  const lease = (await leaseOf(db, key("web")))!;
  await putLease(db, key("web-moved"), lease);
  expect(await leaseOf(db, key("web-moved"))).toMatchObject({ tenantId: acme, extensions: 1, expiresAt: new Date("2027-01-01T00:00:00Z") });
  await putLease(db, key("web", "globex"), lease);
  expect(await leaseOf(db, key("web", "globex"))).toBeUndefined();
});

function run(payload: LeasePayload, instancesOnCluster: Record<string, StubInstance>, log: string[]) {
  const client = stubCluster("lab", instancesOnCluster, log);
  return leaseHandler()({
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "00000000-0000-4000-8000-000000000001", payload },
    signal: new AbortController().signal,
    progress: async () => {},
    clientFor: async () => ({ client, row: { id: lab, name: "lab" } }),
  } as unknown as JobContext);
}

test("the job stops or deletes, and skips a lease extended meanwhile or an instance already gone", async () => {
  const log: string[] = [];
  const running = () => ({ web: { status: "Running", type: "container", config: {} } as StubInstance });
  await setLease(db, key("web"), acme, new Date(Date.now() + DAY));
  expect(await run({ ...key("web"), action: "stop" }, running(), log)).toEqual({ skipped: "the lease was extended or removed" });

  await setLease(db, key("web"), acme, new Date(Date.now() - DAY));
  expect(await run({ ...key("web"), action: "stop" }, running(), log)).toMatchObject({ action: "stop" });
  expect(log).toEqual(["lab stop web"]);
  expect((await leaseOf(db, key("web")))!.actedAt).toBeInstanceOf(Date);

  log.length = 0;
  expect(await run({ ...key("web"), action: "delete" }, running(), log)).toMatchObject({ action: "delete" });
  expect(log).toEqual(["lab stop web", "lab delete web"]);
  expect(await leaseOf(db, key("web"))).toBeUndefined();

  await setLease(db, key("web"), acme, new Date(Date.now() - DAY));
  expect(await run({ ...key("web"), action: "stop" }, {}, log)).toEqual({ skipped: "the instance is gone" });
  expect(await leaseOf(db, key("web"))).toBeUndefined();
});

test("a tenant's leases, soonest first and never-ending last; dropping the policy drops them", async () => {
  await setLease(db, key("never"), acme, null);
  await setLease(db, key("late"), acme, new Date("2027-06-01T00:00:00Z"));
  await setLease(db, key("soon"), acme, new Date("2026-11-01T00:00:00Z"));
  await setLease(db, key("other", "globex"), globex, new Date("2026-10-30T00:00:00Z"));
  expect((await tenantLeases(db, acme)).map((r) => r.lease.name)).toEqual(["soon", "late", "never"]);
  await dropTenantLeases(db, acme);
  expect((await db.select().from(instanceLeases)).map((l) => l.name)).toEqual(["other"]);
});
