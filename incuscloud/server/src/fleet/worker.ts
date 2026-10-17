import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters } from "../db/schema.ts";
import { clusterClient, type ClusterRow } from "../clusters/enroll.ts";
import { log } from "../lib/log.ts";
import { acquireLease, releaseLease } from "../reconcile/lease.ts";
import { collectInventory, type Snapshot } from "./collect.ts";
import { applySnapshot } from "./store.ts";
import { backfillOwners } from "../acl/owners.ts";
import { requestReconcile } from "../reconcile/requests.ts";

export interface FleetWorkerOptions {
  /** This replica's name in the lease. */
  holder: string;
  /** Each cluster's inventory is read this often. */
  intervalMs: number;
  /** Metrics samples are kept this long. */
  retentionMs: number;
  /** How often to look for due clusters. */
  pollMs?: number;
  leaseMs?: number;
  collect?: (row: ClusterRow) => Promise<Snapshot>;
}

const LEASE = "inventory";

/** The inventory loop (P5): while holding its lease, reads each enabled cluster once per interval, one at a time. */
export class FleetWorker {
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly collect: (row: ClusterRow) => Promise<Snapshot>;
  private running?: Promise<void>;
  private stopped = false;
  private wake?: () => void;

  constructor(
    private readonly deps: { db: Db; secretKey: Buffer },
    private readonly opts: FleetWorkerOptions,
  ) {
    this.pollMs = opts.pollMs ?? 5_000;
    this.leaseMs = opts.leaseMs ?? 60_000;
    this.collect = opts.collect ?? ((row) => collectInventory(clusterClient(deps, row)));
  }

  /** One pass; public for tests. */
  async tick(): Promise<void> {
    const { db } = this.deps;
    if (!(await acquireLease(db, LEASE, this.opts.holder, this.leaseMs))) return;
    const staleBefore = new Date(Date.now() - this.opts.intervalMs);
    const due = await db
      .select()
      .from(clusters)
      .where(and(ne(clusters.status, "disabled"), or(isNull(clusters.inventoryAt), lt(clusters.inventoryAt, staleBefore))))
      .orderBy(clusters.name);
    for (const row of due) {
      if (this.stopped) return;
      if (!(await acquireLease(db, LEASE, this.opts.holder, this.leaseMs))) return;
      try {
        const snap = await this.collect(row);
        await applySnapshot(db, row.id, row.name, snap, new Date(), this.opts.retentionMs);
        // Events missed while no listener ran: unclaimed instances go to their tenant's first owner.
        if (await backfillOwners(db, row.id)) await requestReconcile(db, [row.id]);
      } catch (e) {
        const message = (e as Error).message;
        log.warn("inventory failed", { cluster: row.name, error: message });
        // The last inventory stays; the next attempt waits for the interval.
        await db.update(clusters).set({ inventoryAt: new Date(), inventoryError: message.slice(0, 500) }).where(eq(clusters.id, row.id));
      }
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
          log.error("inventory pass failed", { error: (e as Error).message });
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
