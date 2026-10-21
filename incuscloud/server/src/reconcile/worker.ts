import { and, eq, gt, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { clusters } from "../db/schema.ts";
import { log } from "../lib/log.ts";
import { reconcileCluster, type ReconcileDeps, type ReconcileResult } from "./cluster.ts";
import { acquireLease, releaseLease } from "./lease.ts";

export interface WorkerOptions {
  /** This replica's name in the lease. */
  holder: string;
  /** Every cluster is reconciled at least this often (drift). */
  intervalMs?: number;
  /** How often to look for requests. */
  pollMs?: number;
  leaseMs?: number;
  reconcile?: (deps: ReconcileDeps, clusterId: string) => Promise<ReconcileResult>;
}

const LEASE = "reconciler";

/** The reconciler loop: while holding the lease, visits requested and stale clusters one at a time. */
export class Worker {
  private readonly intervalMs: number;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly reconcile: NonNullable<WorkerOptions["reconcile"]>;
  private running?: Promise<void>;
  private stopped = false;
  private wake?: () => void;

  constructor(
    private readonly deps: ReconcileDeps,
    private readonly opts: WorkerOptions,
  ) {
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.pollMs = opts.pollMs ?? 1_000;
    this.leaseMs = opts.leaseMs ?? 30_000;
    this.reconcile = opts.reconcile ?? reconcileCluster;
  }

  /** One pass; public for tests. */
  async tick(): Promise<void> {
    const { db } = this.deps;
    if (!(await acquireLease(db, LEASE, this.opts.holder, this.leaseMs))) return;
    const staleBefore = new Date(Date.now() - this.intervalMs);
    const due = await db
      .select({ id: clusters.id, name: clusters.name, generation: clusters.reconcileGeneration })
      .from(clusters)
      .where(and(ne(clusters.status, "disabled"), or(gt(clusters.reconcileGeneration, clusters.reconciledGeneration), isNull(clusters.reconciledAt), lt(clusters.reconciledAt, staleBefore))))
      .orderBy(clusters.name);
    for (const c of due) {
      if (this.stopped) return;
      // Renew before each cluster; another replica may have taken over if this one stalled.
      if (!(await acquireLease(db, LEASE, this.opts.holder, this.leaseMs))) return;
      try {
        const r = await this.reconcile(this.deps, c.id);
        if (r.status !== "ready") log.warn("cluster not converged", { cluster: c.name, status: r.status, message: r.message });
      } catch (e) {
        log.error("reconcile failed", { cluster: c.name, error: (e as Error).message });
      }
      // Requests made since the pass started (a higher generation) stay for the next one.
      await db
        .update(clusters)
        .set({ reconciledGeneration: c.generation, reconcileRequestedAt: sql`case when ${clusters.reconcileGeneration} = ${c.generation} then null else ${clusters.reconcileRequestedAt} end` })
        .where(eq(clusters.id, c.id));
    }
    // Disabled clusters are never visited; drop their requests.
    await db
      .update(clusters)
      .set({ reconcileRequestedAt: null, reconciledGeneration: sql`${clusters.reconcileGeneration}` })
      .where(and(eq(clusters.status, "disabled"), isNotNull(clusters.reconcileRequestedAt)));
  }

  start(): void {
    if (this.running) return;
    this.stopped = false;
    this.running = (async () => {
      while (!this.stopped) {
        try {
          await this.tick();
        } catch (e) {
          log.error("reconciler pass failed", { error: (e as Error).message });
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

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.running;
    this.running = undefined;
    await releaseLease(this.deps.db, LEASE, this.opts.holder);
  }
}
