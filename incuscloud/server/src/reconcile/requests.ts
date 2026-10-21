import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, placements } from "../db/schema.ts";

export type ReconcileTarget = string[] | "all" | { tenant: string };

/** Asks the reconciler (any replica) to visit these clusters soon; stored, so it survives restarts. */
export async function requestReconcile(db: Db, target: ReconcileTarget): Promise<void> {
  const set = { reconcileRequestedAt: sql`now()`, reconcileGeneration: sql`${clusters.reconcileGeneration} + 1` };
  if (target === "all") {
    await db.update(clusters).set(set);
  } else if (Array.isArray(target)) {
    if (target.length) await db.update(clusters).set(set).where(inArray(clusters.id, target));
  } else {
    const placed = db.select({ id: placements.clusterId }).from(placements).where(eq(placements.tenantId, target.tenant));
    await db.update(clusters).set(set).where(inArray(clusters.id, placed));
  }
}
