import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { instanceOwners, instances, placements, tenantMembers } from "../db/schema.ts";

export interface InstanceKey {
  clusterId: string;
  project: string;
  name: string;
}
/** IncusCloud's own jobs know best; then the clusters' events; the backfill only fills gaps. */
export type OwnerSource = "incuscloud" | "event" | "backfill";
const RANK: Record<OwnerSource, number> = { backfill: 0, event: 1, incuscloud: 2 };

const at = (k: InstanceKey) => and(eq(instanceOwners.clusterId, k.clusterId), eq(instanceOwners.project, k.project), eq(instanceOwners.name, k.name));
const columns = (subject: string) => {
  const [kind, id] = subject.split(":") as [string, string];
  return kind === "service" ? { userId: null, serviceAccountId: id } : { userId: id, serviceAccountId: null };
};

/** Records `subject` (`user:<id>` or `service:<id>`) as the owner, unless a better-sourced owner is recorded. */
export async function recordOwner(db: Db, k: InstanceKey, subject: string, source: OwnerSource): Promise<void> {
  const row = { ...k, ...columns(subject), source };
  const beaten = Object.entries(RANK)
    .filter(([, r]) => r <= RANK[source])
    .map(([s]) => s);
  await db
    .insert(instanceOwners)
    .values(row)
    .onConflictDoUpdate({
      target: [instanceOwners.clusterId, instanceOwners.project, instanceOwners.name],
      set: { userId: row.userId, serviceAccountId: row.serviceAccountId, source, createdAt: new Date() },
      // Backfill only fills gaps; otherwise an equal or better source wins.
      setWhere: source === "backfill" ? sql`false` : sql`${instanceOwners.source} in (${sql.join(beaten.map((s) => sql`${s}`), sql`, `)})`,
    });
}

export async function renameOwned(db: Db, from: InstanceKey, to: InstanceKey): Promise<void> {
  await db.update(instanceOwners).set(to).where(at(from));
}

export async function forgetOwned(db: Db, k: InstanceKey): Promise<void> {
  await db.delete(instanceOwners).where(at(k));
}

/** The owner as a subject; null when unowned or unknown. */
export async function ownerOf(db: Db, k: InstanceKey): Promise<string | null> {
  const [r] = await db.select().from(instanceOwners).where(at(k));
  return r?.userId ? `user:${r.userId}` : r?.serviceAccountId ? `service:${r.serviceAccountId}` : null;
}

/**
 * Gives the instances in this cluster's tenant projects that nobody claimed
 * to their tenant's first owner (by joining date). A tenant without owners
 * leaves them unowned, so only its admins and above manage them.
 */
export async function backfillOwners(db: Db, clusterId: string): Promise<number> {
  const orphans = await db
    .select({ project: instances.project, name: instances.name, tenantId: placements.tenantId })
    .from(instances)
    .innerJoin(placements, and(eq(placements.clusterId, instances.clusterId), eq(placements.project, instances.project)))
    .leftJoin(instanceOwners, and(eq(instanceOwners.clusterId, instances.clusterId), eq(instanceOwners.project, instances.project), eq(instanceOwners.name, instances.name)))
    .where(and(eq(instances.clusterId, clusterId), isNull(instanceOwners.source)));
  let n = 0;
  const firstOwner = new Map<string, string | null>();
  for (const o of orphans) {
    if (!firstOwner.has(o.tenantId)) {
      const [f] = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, o.tenantId), eq(tenantMembers.role, "owner")))
        .orderBy(asc(tenantMembers.createdAt), asc(tenantMembers.userId))
        .limit(1);
      firstOwner.set(o.tenantId, f?.userId ?? null);
    }
    const owner = firstOwner.get(o.tenantId);
    if (!owner) continue;
    await recordOwner(db, { clusterId, project: o.project, name: o.name }, `user:${owner}`, "backfill");
    n++;
  }
  return n;
}

/** A job's actor as an owner subject; system jobs (schedules) have none. */
export const actorOf = (job: { actorType?: string; actorId?: string }): string | null =>
  (job.actorType === "user" || job.actorType === "service") && job.actorId ? `${job.actorType}:${job.actorId}` : null;

/** Gives `to` the owner `from` has (a replica, a moved instance); with `move`, `from` is forgotten. */
export async function carryOwner(db: Db, from: InstanceKey, to: InstanceKey, opts: { move?: boolean } = {}): Promise<void> {
  const [r] = await db.select().from(instanceOwners).where(at(from));
  if (!r) return;
  await db.transaction(async (tx) => {
    await tx.delete(instanceOwners).where(at(to));
    await tx.insert(instanceOwners).values({ ...to, userId: r.userId, serviceAccountId: r.serviceAccountId, source: "incuscloud" });
    if (opts.move) await tx.delete(instanceOwners).where(at(from));
  });
}
