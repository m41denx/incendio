import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, jobs } from "../db/schema.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let acme: { id: string };
let other: { id: string };

beforeEach(async () => {
  h = await harness();
  acme = await h.tenant("acme");
  other = await h.tenant("other");
});
const job = (tenantId: string | null, actorId = "someone", type = "migrate") => enqueueJob(h.db, { type, payload: { name: "web" }, actor: { type: "user", id: actorId }, tenantId });

test("platform viewers see every job, newest first, with filters", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const a = await job(acme.id);
  const b = await job(null, "x", "replicate");
  // Created in the same millisecond otherwise: make the order unambiguous.
  await h.db.update(jobs).set({ state: "succeeded", createdAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, a.id));
  const all = await h.call(v, "GET", "/api/v1/jobs");
  expect(all.body.map((j: { id: string }) => j.id)).toEqual([b.id, a.id]);
  expect((await h.call(v, "GET", "/api/v1/jobs?state=succeeded")).body.map((j: { id: string }) => j.id)).toEqual([a.id]);
  expect((await h.call(v, "GET", "/api/v1/jobs?type=replicate")).body.map((j: { id: string }) => j.id)).toEqual([b.id]);
  expect((await h.call(v, "GET", `/api/v1/jobs?tenant=${acme.id}`)).body.map((j: { id: string }) => j.id)).toEqual([a.id]);
  expect((await h.call(v, "GET", "/api/v1/jobs?limit=1")).body).toHaveLength(1);
});

test("others see their tenants' jobs and their own; anything else is not found", async () => {
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "viewer" } });
  const mine = await job(acme.id);
  const own = await job(null, m.id);
  const foreign = await job(other.id);
  const r = await h.call(m, "GET", "/api/v1/jobs");
  expect(r.body.map((j: { id: string }) => j.id).sort()).toEqual([mine.id, own.id].sort());
  expect((await h.call(m, "GET", `/api/v1/jobs/${mine.id}`)).body.payload).toEqual({ name: "web" });
  expect((await h.call(m, "GET", `/api/v1/jobs/${foreign.id}`)).status).toBe(404);
  expect((await h.call(m, "GET", "/api/v1/jobs/not-a-uuid")).status).toBe(404);
});

test("cancelling: a queued job at once, a running one by request, a finished one never", async () => {
  const ta = await h.user("ta@example.com", { tenants: { [acme.id]: "admin" } });
  const queued = await job(acme.id);
  const r = await h.call(ta, "POST", `/api/v1/jobs/${queued.id}/cancel`);
  expect(r.status).toBe(202);
  expect(r.body).toMatchObject({ state: "cancelled" });
  const running = await job(acme.id);
  await h.db.update(jobs).set({ state: "running" }).where(eq(jobs.id, running.id));
  expect((await h.call(ta, "POST", `/api/v1/jobs/${running.id}/cancel`)).body).toMatchObject({ state: "running", cancelRequested: true });
  const done = await job(acme.id);
  await h.db.update(jobs).set({ state: "succeeded" }).where(eq(jobs.id, done.id));
  expect((await h.call(ta, "POST", `/api/v1/jobs/${done.id}/cancel`)).status).toBe(409);
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "job.cancel"))).length).toBe(3);
});

test("who may cancel: the job's actor, tenant owners and admins, platform operators", async () => {
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const op = await h.user("op@example.com", { platformRole: "operator" });
  const theirs = await job(acme.id);
  expect((await h.call(m, "POST", `/api/v1/jobs/${theirs.id}/cancel`)).status).toBe(403);
  expect((await h.call(v, "POST", `/api/v1/jobs/${theirs.id}/cancel`)).status).toBe(403);
  const own = await job(acme.id, m.id);
  expect((await h.call(m, "POST", `/api/v1/jobs/${own.id}/cancel`)).status).toBe(202);
  expect((await h.call(op, "POST", `/api/v1/jobs/${theirs.id}/cancel`)).status).toBe(202);
});
