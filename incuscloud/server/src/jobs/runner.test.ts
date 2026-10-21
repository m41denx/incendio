import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { jobs, leases } from "../db/schema.ts";
import { acquireLease } from "../reconcile/lease.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "./queue.ts";
import { JobRunner } from "./runner.ts";
import type { JobHandler } from "./types.ts";

let db: Db;
const actor = { type: "user" as const, id: "u1" };
const runner = (handlers: Record<string, JobHandler>, o: Partial<ConstructorParameters<typeof JobRunner>[1]> = {}) =>
  new JobRunner({ db, secretKey: Buffer.alloc(32) }, { holder: "w1", handlers, concurrency: 2, cancelPollMs: 10, heartbeatMs: 20, ...o });
const settle = async (id: string, ms = 2000) => {
  const end = Date.now() + ms;
  for (;;) {
    const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (j && ["succeeded", "failed", "cancelled"].includes(j.state)) return j;
    if (Date.now() > end) throw new Error(`job still ${j?.state}`);
    await Bun.sleep(10);
  }
};

beforeEach(async () => {
  db = await testDb();
});

test("a job runs to success with its progress and result", async () => {
  const j = await enqueueJob(db, { type: "echo", payload: { x: 1 }, actor });
  expect(j.state).toBe("queued");
  const r = runner({
    echo: async (ctx) => {
      await ctx.progress({ stage: "working", percent: 50 });
      return { got: ctx.job.payload };
    },
  });
  await r.tick();
  const done = await settle(j.id);
  expect(done).toMatchObject({ state: "succeeded", result: { got: { x: 1 } }, progress: { stage: "working", percent: 50 }, holder: "w1" });
  expect(done.startedAt).not.toBeNull();
  expect(done.finishedAt).not.toBeNull();
  await r.stop();
});

test("a failing handler fails the job with its message; an unknown type fails too", async () => {
  const a = await enqueueJob(db, { type: "boom", payload: {}, actor });
  const b = await enqueueJob(db, { type: "nope", payload: {}, actor });
  const r = runner({
    boom: async () => {
      throw new Error("kaboom");
    },
  });
  await r.tick();
  expect(await settle(a.id)).toMatchObject({ state: "failed", error: "kaboom" });
  expect(await settle(b.id)).toMatchObject({ state: "failed", error: "No handler for job type nope" });
  await r.stop();
});

test("a cancel request aborts the handler's signal and the job is cancelled", async () => {
  const j = await enqueueJob(db, { type: "wait", payload: {}, actor });
  const r = runner({
    wait: (ctx) =>
      new Promise((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
      }),
  });
  await r.tick();
  await Bun.sleep(30);
  await db.update(jobs).set({ cancelRequested: true }).where(eq(jobs.id, j.id));
  expect(await settle(j.id)).toMatchObject({ state: "cancelled" });
  await r.stop();
});

test("no more than the concurrency run at once; the rest wait their turn", async () => {
  let running = 0;
  let peak = 0;
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await enqueueJob(db, { type: "slow", payload: {}, actor })).id);
  const r = runner({
    slow: async () => {
      peak = Math.max(peak, ++running);
      await Bun.sleep(40);
      running--;
    },
  });
  r.start();
  for (const id of ids) await settle(id);
  await r.stop();
  expect(peak).toBe(2);
});

test("one active job per instance: a second is refused until the first is done", async () => {
  const first = await enqueueJob(db, { type: "x", payload: {}, actor, instanceKey: "c/p/n" });
  const err = await enqueueJob(db, { type: "x", payload: {}, actor, instanceKey: "c/p/n" }).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(409);
  await db.update(jobs).set({ state: "succeeded" }).where(eq(jobs.id, first.id));
  expect((await enqueueJob(db, { type: "x", payload: {}, actor, instanceKey: "c/p/n" })).state).toBe("queued");
});

test("a job left running by a worker that stopped is marked interrupted", async () => {
  const j = await enqueueJob(db, { type: "x", payload: {}, actor });
  await db.update(jobs).set({ state: "running", holder: "dead", heartbeatAt: new Date(Date.now() - 600_000) }).where(eq(jobs.id, j.id));
  const fresh = await enqueueJob(db, { type: "x", payload: {}, actor });
  await db.update(jobs).set({ state: "running", holder: "alive", heartbeatAt: new Date() }).where(eq(jobs.id, fresh.id));
  const r = runner({});
  await r.tick();
  const [dead] = await db.select().from(jobs).where(eq(jobs.id, j.id));
  expect(dead).toMatchObject({ state: "failed", error: "interrupted: the worker running it stopped" });
  const [alive] = await db.select().from(jobs).where(eq(jobs.id, fresh.id));
  expect(alive!.state).toBe("running");
  await r.stop();
});

test("without the lease nothing runs; stop releases it", async () => {
  expect(await acquireLease(db, "jobs", "other", 30_000)).toBe(true);
  const j = await enqueueJob(db, { type: "echo", payload: {}, actor });
  await runner({ echo: async () => {} }).tick();
  expect((await db.select().from(jobs).where(eq(jobs.id, j.id)))[0]!.state).toBe("queued");
  await db.delete(leases);
  const r = runner({ echo: async () => {} });
  await r.tick();
  await settle(j.id);
  await r.stop();
  expect(await db.select().from(leases)).toEqual([]);
});
