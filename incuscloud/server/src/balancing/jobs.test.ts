import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { balancingPolicies, clusters, jobs } from "../db/schema.ts";
import type { JobContext } from "../jobs/types.ts";
import { fakeMembers, type FakeInstance, type FakeMember } from "../test/fake-members.ts";
import { evacuateHandler, rebalanceHandler, restoreMemberHandler, scheduleBalancing } from "./jobs.ts";

const GiB = 1024 ** 3;
let db: Db;
let clusterId: string;

beforeEach(async () => {
  db = await testDb();
  const [c] = await db.insert(clusters).values({ name: "D", url: "https://d:8443", fingerprint: "ab", serverCert: "pem", clientCert: "pem", clientKeyEnc: "v1.x.y" }).returning();
  clusterId = c!.id;
});

const m = (name: string, base = 1): FakeMember => ({ name, status: "Online", memoryTotal: 16 * GiB, memoryBase: base * GiB, cpus: 8 });
const i = (name: string, location: string, gib: number, over: Partial<FakeInstance> = {}): FakeInstance => ({ project: "acme", name, type: "container", status: "Running", location, memory: gib * GiB, config: {}, ...over });

function ctxFor(fake: ReturnType<typeof fakeMembers>, payload: Record<string, unknown>, signal = new AbortController().signal) {
  const stages: string[] = [];
  const ctx = {
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "00000000-0000-4000-8000-000000000009", tenantId: null, actorType: "user", actorId: "u1", payload: { clusterId, ...payload } },
    signal,
    progress: async (p: { stage: string }) => void stages.push(p.stage),
    clientFor: async () => ({ client: fake, row: { id: clusterId, name: "D" } }),
  } as unknown as JobContext;
  return { ctx, stages };
}
type Result = { before: number; after: number; moves: Array<{ name: string; from: string; to: string; outcome: string; detail?: string }>; notes: string[] };
const run = async (fake: ReturnType<typeof fakeMembers>, signal?: AbortSignal) => (await rebalanceHandler()(ctxFor(fake, {}, signal).ctx)) as unknown as Result;
const policy = (over: Partial<typeof balancingPolicies.$inferInsert> = {}) => db.insert(balancingPolicies).values({ clusterId, updatedBy: "user:u1", ...over });

test("stopped instances move as they are; a running container without restarts allowed stays", async () => {
  // Assigned mode: the stopped one weighs too.
  const fake = fakeMembers([m("d1"), m("d2")], [i("ct", "d1", 1, { config: { "limits.memory": "6GiB" } }), i("off", "d1", 0, { status: "Stopped", config: { "limits.memory": "6GiB" } })]);
  await policy({ mode: "assigned" });
  const r = await run(fake);
  expect(r.moves.map((x) => `${x.name}:${x.from}→${x.to}:${x.outcome}`)).toEqual(["off:d1→d2:moved"]);
  expect(fake.log).toEqual(["move off d1→d2"]);
});

test("running containers move with a restart only when the policy allows it, and the run says why not otherwise", async () => {
  const world = () => fakeMembers([m("d1"), m("d2")], [i("ct1", "d1", 3), i("ct2", "d1", 3)]);
  let fake = world();
  await policy();
  let r = await run(fake);
  expect(r.moves).toEqual([]);
  expect(r.notes.join(" ")).toMatch(/2 running instances can only move with a restart/);

  fake = world();
  await db.update(balancingPolicies).set({ allowRestart: true });
  r = await run(fake);
  expect(r.moves.map((x) => `${x.name}:${x.outcome}`)).toEqual(["ct1:moved"]);
  expect(fake.log).toEqual(["stop ct1", "move ct1 d1→d2", "start ct1"]);
  expect(fake.instances[0]).toMatchObject({ location: "d2", status: "Running" });
});

test("a VM that can move live moves live, without a restart", async () => {
  const fake = fakeMembers([m("d1"), m("d2")], [i("vm", "d1", 4, { type: "virtual-machine", config: { "migration.stateful": "true" } }), i("ct", "d1", 4)]);
  const r = await run(fake);
  expect(r.moves.map((x) => `${x.name}:${x.outcome}`)).toEqual(["vm:moved"]);
  expect(fake.log).toEqual(["move vm d1→d2 live"]);
});

test("a failed move is reported and the instance started again where it was; the run goes on", async () => {
  const fake = fakeMembers([m("d1"), m("d2"), m("d3")], [i("a", "d1", 4), i("b", "d1", 4), i("c", "d1", 4)]);
  await policy({ allowRestart: true });
  fake.failMove.add("a");
  const r = await run(fake);
  const a = r.moves.find((x) => x.name === "a")!;
  expect(a.outcome).toBe("failed");
  expect(a.detail).toMatch(/moving a failed/);
  expect(fake.instances[0]).toMatchObject({ location: "d1", status: "Running" });
  expect(r.moves.filter((x) => x.outcome === "moved").length).toBeGreaterThan(0);
  const [p] = await db.select().from(balancingPolicies);
  expect(p!.lastError).toMatch(/1 of \d+ moves failed/);
});

test("an instance that changed member since the plan is skipped with the reason", async () => {
  const fake = fakeMembers([m("d1"), m("d2")], [i("x", "d1", 0, { status: "Stopped", config: { "limits.memory": "4GiB" } }), i("y", "d1", 0, { status: "Stopped", config: { "limits.memory": "4GiB" } })]);
  await policy({ mode: "assigned" });
  let first = true;
  const real = fake.request.bind(fake);
  fake.request = (async (method: string, path: string, body?: Record<string, unknown>) => {
    // The fresh re-read of the instance right before its move finds it elsewhere.
    if (method === "GET" && path.startsWith("/1.0/instances/x") && first) {
      first = false;
      fake.instances[0]!.location = "d2";
    }
    return real(method, path, body);
  }) as typeof fake.request;
  const r = await run(fake);
  expect(r.moves).toEqual([expect.objectContaining({ name: "x", outcome: "skipped", detail: "now on d2" })]);
  expect(fake.log).toEqual([]);
});

test("excluded members and projects, and evacuated members, are left alone", async () => {
  const fake = fakeMembers([m("d1"), m("d2"), m("d3"), m("d4")], [i("theirs", "d1", 0, { project: "keepout", status: "Stopped", config: { "limits.memory": "8GiB" } }), i("ours", "d1", 0, { status: "Stopped", config: { "limits.memory": "4GiB" } })]);
  fake.members[2]!.status = "Evacuated";
  await policy({ mode: "assigned", excludeProjects: ["keepout"], excludeMembers: ["d2"] });
  const r = await run(fake);
  expect(r.moves.map((x) => `${x.name}:${x.from}→${x.to}`)).toEqual(["ours:d1→d4"]);
});

test("cancelled between moves: the rest is not done", async () => {
  const off = (n: string) => i(n, "d1", 0, { status: "Stopped", config: { "limits.memory": "4GiB" } });
  const fake = fakeMembers([m("d1"), m("d2"), m("d3")], [off("a"), off("b"), off("c")]);
  await policy({ mode: "assigned" });
  const ac = new AbortController();
  fake.beforeMove = () => ac.abort(new Error("cancelled"));
  await expect(run(fake, ac.signal)).rejects.toThrow("cancelled");
  expect(fake.log.filter((l) => l.startsWith("move"))).toHaveLength(1);
});

test("the policy records its run; the inventory is refreshed after moves", async () => {
  const off = (n: string) => i(n, "d1", 0, { status: "Stopped", config: { "limits.memory": "4GiB" } });
  const fake = fakeMembers([m("d1"), m("d2")], [off("a"), off("b")]);
  await policy({ mode: "assigned" });
  await db.update(clusters).set({ inventoryAt: new Date() });
  await run(fake);
  const [p] = await db.select().from(balancingPolicies);
  expect(p!.lastSuccessAt).not.toBeNull();
  expect(p!.lastError).toBe("");
  const [c] = await db.select().from(clusters);
  expect(c!.inventoryAt).toBeNull();
});

test("a standalone server cannot be balanced", async () => {
  const fake = fakeMembers([m("solo")], []);
  const real = fake.request.bind(fake);
  fake.request = (async (method: string, path: string, body?: Record<string, unknown>) =>
    path === "/1.0" ? { type: "sync", status_code: 200, metadata: { environment: { server_clustered: false, server_name: "solo" } } } : real(method, path, body)) as typeof fake.request;
  await expect(run(fake)).rejects.toThrow(/not a cluster/i);
});

test("evacuate and restore a member", async () => {
  const fake = fakeMembers([m("d1"), m("d2")], [i("web", "d1", 1)]);
  await evacuateHandler()(ctxFor(fake, { member: "d1", mode: "migrate" }).ctx);
  expect(fake.log).toEqual(["evacuate d1 migrate"]);
  expect(fake.members[0]!.status).toBe("Evacuated");
  expect(fake.instances[0]!.location).toBe("d2");
  await restoreMemberHandler()(ctxFor(fake, { member: "d1" }).ctx);
  expect(fake.members[0]!.status).toBe("Online");
  expect(fake.instances[0]!.location).toBe("d1");
  await expect(evacuateHandler()(ctxFor(fake, { member: "d9", mode: "auto" }).ctx)).rejects.toThrow(/not found/i);
});

test("the scheduler enqueues enabled policies that are due, once", async () => {
  await policy({ enabled: true, intervalS: 300 });
  await scheduleBalancing(db);
  await scheduleBalancing(db);
  const js = await db.select().from(jobs);
  expect(js.map((j) => [j.type, j.instanceKey])).toEqual([["rebalance", `rebalance:${clusterId}`]]);
  await db.update(balancingPolicies).set({ enabled: false, lastRunAt: null });
  await db.delete(jobs);
  await scheduleBalancing(db);
  expect(await db.select().from(jobs)).toEqual([]);
  // Not yet due.
  await db.update(balancingPolicies).set({ enabled: true, lastRunAt: new Date() }).where(eq(balancingPolicies.clusterId, clusterId));
  await scheduleBalancing(db);
  expect(await db.select().from(jobs)).toEqual([]);
});

test("one running instance that needs a restart is counted in the singular", async () => {
  const fake = fakeMembers([m("d1"), m("d2")], [i("ct1", "d1", 3)]);
  const r = await run(fake);
  expect(r.notes).toContain("1 running instance can only move with a restart, which the policy does not allow");
});
