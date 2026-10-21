import { and, asc, eq, lt, ne } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, jobs, type JobProgress } from "../db/schema.ts";
import { clusterClient } from "../clusters/enroll.ts";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { acquireLease, releaseLease } from "../reconcile/lease.ts";
import type { JobContext, JobHandler, JobRow } from "./types.ts";

export interface JobRunnerOptions {
  /** This replica's name in the lease and on the jobs it runs. */
  holder: string;
  handlers: Record<string, JobHandler>;
  concurrency: number;
  pollMs?: number;
  leaseMs?: number;
  /** How often a running job heartbeats and checks for a cancel request. */
  cancelPollMs?: number;
  /** A running job of another holder without a heartbeat for this long was interrupted. */
  heartbeatMs?: number;
  /** Runs at the start of every pass while holding the lease (schedulers). */
  beforeTick?: () => Promise<void>;
}

const LEASE = "jobs";
const INTERRUPTED = "interrupted: the worker running it stopped";

/** The job loop: while holding its lease, runs queued jobs, a few at a time. */
export class JobRunner {
  private readonly active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly cancelPollMs: number;
  private readonly staleMs: number;
  private running?: Promise<void>;
  private stopped = false;
  private wake?: () => void;

  constructor(
    private readonly deps: { db: Db; secretKey: Buffer },
    private readonly opts: JobRunnerOptions,
  ) {
    this.pollMs = opts.pollMs ?? 2_000;
    this.leaseMs = opts.leaseMs ?? 60_000;
    this.cancelPollMs = opts.cancelPollMs ?? 2_000;
    this.staleMs = 3 * Math.max(this.leaseMs, opts.heartbeatMs ?? 0);
  }

  /** One pass; public for tests. */
  async tick(): Promise<void> {
    const { db } = this.deps;
    if (!(await acquireLease(db, LEASE, this.opts.holder, this.leaseMs))) return;
    // Jobs another worker was running when it went away.
    await db
      .update(jobs)
      .set({ state: "failed", error: INTERRUPTED, finishedAt: new Date() })
      .where(and(eq(jobs.state, "running"), ne(jobs.holder, this.opts.holder), lt(jobs.heartbeatAt, new Date(Date.now() - this.staleMs))));
    try {
      await this.opts.beforeTick?.();
    } catch (e) {
      log.error("job scheduler failed", { error: (e as Error).message });
    }
    while (!this.stopped && this.active.size < this.opts.concurrency) {
      const [next] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.state, "queued")).orderBy(asc(jobs.createdAt)).limit(1);
      if (!next) break;
      const now = new Date();
      const [job] = await db
        .update(jobs)
        .set({ state: "running", holder: this.opts.holder, startedAt: now, heartbeatAt: now })
        .where(and(eq(jobs.id, next.id), eq(jobs.state, "queued")))
        .returning();
      if (job) this.launch(job);
    }
  }

  private launch(job: JobRow) {
    const abort = new AbortController();
    const done = this.run(job, abort).finally(() => {
      this.active.delete(job.id);
      this.wake?.();
    });
    this.active.set(job.id, { abort, done });
  }

  private async run(job: JobRow, abort: AbortController): Promise<void> {
    const { db } = this.deps;
    const finish = (set: Partial<typeof jobs.$inferInsert>) => db.update(jobs).set({ ...set, finishedAt: new Date() }).where(eq(jobs.id, job.id));
    const handler = this.opts.handlers[job.type];
    if (!handler) {
      await finish({ state: "failed", error: `No handler for job type ${job.type}` });
      return;
    }
    // Heartbeat, and turn a cancel request into an abort.
    const beat = setInterval(async () => {
      try {
        const [row] = await db.update(jobs).set({ heartbeatAt: new Date() }).where(eq(jobs.id, job.id)).returning({ cancel: jobs.cancelRequested });
        if (row?.cancel && !abort.signal.aborted) abort.abort(new ApiError(409, "cancelled", "Cancelled"));
      } catch (e) {
        log.warn("job heartbeat failed", { job: job.id, error: (e as Error).message });
      }
    }, this.cancelPollMs);
    const ctx: JobContext = {
      db,
      secretKey: this.deps.secretKey,
      job,
      signal: abort.signal,
      progress: async (p: JobProgress) => {
        await db.update(jobs).set({ progress: p }).where(eq(jobs.id, job.id));
      },
      clientFor: async (clusterId) => {
        const [row] = await db.select().from(clusters).where(eq(clusters.id, clusterId));
        if (!row) throw new ApiError(404, "not_found", "Cluster not found");
        return { client: clusterClient(this.deps, row), row };
      },
    };
    try {
      const result = await handler(ctx);
      await finish({ state: "succeeded", result: result ?? {} });
    } catch (e) {
      const message = (e as Error).message;
      if (this.stopped) await finish({ state: "failed", error: INTERRUPTED });
      else if (abort.signal.aborted) await finish({ state: "cancelled", error: "" });
      else await finish({ state: "failed", error: message.slice(0, 2000) });
      if (!abort.signal.aborted) log.warn("job failed", { job: job.id, type: job.type, error: message });
    } finally {
      clearInterval(beat);
    }
  }

  start(): void {
    if (this.running) return;
    this.stopped = false;
    this.running = (async () => {
      while (!this.stopped) {
        try {
          await this.tick();
        } catch (e) {
          log.error("job pass failed", { error: (e as Error).message });
        }
        if (this.stopped) break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.pollMs);
          this.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
      }
    })();
  }

  /** Stops taking jobs; running ones are aborted (their handlers clean up) and end failed as interrupted. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.running;
    this.running = undefined;
    for (const { abort } of this.active.values()) abort.abort(new Error("the worker is stopping"));
    await Promise.all([...this.active.values()].map((a) => a.done));
    await releaseLease(this.deps.db, LEASE, this.opts.holder);
  }
}
