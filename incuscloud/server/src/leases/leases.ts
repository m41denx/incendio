import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { instanceLeases, instances, placements, tenants, type LeasePolicy } from "../db/schema.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { JobHandler } from "../jobs/types.ts";
import { ApiError } from "../lib/errors.ts";
import { incusDo, instancePath, refreshInventory, setState } from "../mobility/migrate-job.ts";
import { readInstance } from "../mobility/facts.ts";
import type { InstanceKey } from "../acl/owners.ts";

/**
 * Leases (permissions phase 6): a tenant's policy gives each of its
 * instances a time to live; holders of `instance.configure` extend it a
 * limited number of times; when it ends, a job stops or deletes the
 * instance. The worker's scheduler (before each job pass) hands out leases
 * and queues the jobs.
 */

export type Lease = typeof instanceLeases.$inferSelect;
const DAY_MS = 86400_000;
// The key alone: callers may pass inventory rows, whose other columns (createdAt) are not the lease's.
const keyOf = ({ clusterId, project, name }: InstanceKey): InstanceKey => ({ clusterId, project, name });
const at = (k: InstanceKey) => and(eq(instanceLeases.clusterId, k.clusterId), eq(instanceLeases.project, k.project), eq(instanceLeases.name, k.name));

export async function leaseOf(db: Db, k: InstanceKey): Promise<Lease | undefined> {
  const [r] = await db.select().from(instanceLeases).where(at(k));
  return r;
}

export async function renameLease(db: Db, from: InstanceKey, to: InstanceKey): Promise<void> {
  await db.update(instanceLeases).set(keyOf(to)).where(at(from));
}

export async function forgetLease(db: Db, k: InstanceKey): Promise<void> {
  await db.delete(instanceLeases).where(at(k));
}

/**
 * A moved instance keeps its lease (read before the source went away), when it stays in the same
 * tenant; in another tenant's project it gets that tenant's policy instead.
 */
export async function putLease(db: Db, to: InstanceKey, lease: Lease): Promise<void> {
  const [placed] = await db.select({ tenantId: placements.tenantId }).from(placements).where(and(eq(placements.clusterId, to.clusterId), eq(placements.project, to.project)));
  if (placed?.tenantId !== lease.tenantId) return;
  const { clusterId: _c, project: _p, name: _n, ...rest } = lease;
  await db.transaction(async (tx) => {
    await tx.delete(instanceLeases).where(at(to));
    await tx.insert(instanceLeases).values({ ...rest, ...keyOf(to) });
  });
}

/** The lease as the console shows it, with what the policy still allows. */
export function leaseView(lease: Lease | undefined, policy: LeasePolicy | null | undefined) {
  if (!lease || !policy) return null;
  return {
    expiresAt: lease.expiresAt,
    extensions: lease.extensions,
    maxExtensions: policy.maxExtensions,
    extendDays: policy.extendDays,
    action: policy.action,
    actedAt: lease.actedAt,
  };
}

/** Extends by the policy's `extendDays` from the later of now and the current end. */
export async function extendLease(db: Db, k: InstanceKey, policy: LeasePolicy): Promise<Lease> {
  const lease = await leaseOf(db, k);
  if (!lease) throw new ApiError(404, "not_found", "This instance has no lease");
  if (!lease.expiresAt) throw new ApiError(409, "conflict", "This instance's lease never ends");
  if (lease.extensions >= policy.maxExtensions) throw new ApiError(409, "conflict", `No extensions left: the tenant allows ${policy.maxExtensions === 1 ? "one" : policy.maxExtensions}`);
  const from = Math.max(Date.now(), lease.expiresAt.getTime());
  const [r] = await db
    .update(instanceLeases)
    .set({ expiresAt: new Date(from + policy.extendDays * DAY_MS), extensions: lease.extensions + 1, actedAt: null })
    .where(and(at(k), eq(instanceLeases.extensions, lease.extensions)))
    .returning();
  if (!r) throw new ApiError(409, "conflict", "The lease changed meanwhile; try again");
  return r;
}

/** Sets the end outright (null: never), as the platform may; the lease is the instance's tenant's from then on. */
export async function setLease(db: Db, k: InstanceKey, tenantId: string, expiresAt: Date | null): Promise<Lease> {
  const [r] = await db
    .insert(instanceLeases)
    .values({ ...keyOf(k), tenantId, expiresAt })
    .onConflictDoUpdate({ target: [instanceLeases.clusterId, instanceLeases.project, instanceLeases.name], set: { tenantId, expiresAt, actedAt: null } })
    .returning();
  return r!;
}

export interface LeasePayload {
  clusterId: string;
  project: string;
  name: string;
  action: "stop" | "delete";
}

/**
 * Hands out leases to the instances of tenants with a policy that have none yet, then queues a
 * job for each ended lease whose action is still to take: a delete, or a stop of an instance the
 * inventory has seen running since the last stop.
 */
export async function scheduleLeases(db: Db, now = new Date()): Promise<void> {
  const unleased = await db
    .select({ clusterId: instances.clusterId, project: instances.project, name: instances.name, tenantId: tenants.id, policy: tenants.leasePolicy })
    .from(instances)
    .innerJoin(placements, and(eq(placements.clusterId, instances.clusterId), eq(placements.project, instances.project)))
    .innerJoin(tenants, eq(tenants.id, placements.tenantId))
    .leftJoin(instanceLeases, and(eq(instanceLeases.clusterId, instances.clusterId), eq(instanceLeases.project, instances.project), eq(instanceLeases.name, instances.name)))
    .where(and(isNotNull(tenants.leasePolicy), isNull(instanceLeases.name)));
  for (const u of unleased) {
    await db
      .insert(instanceLeases)
      .values({ clusterId: u.clusterId, project: u.project, name: u.name, tenantId: u.tenantId, expiresAt: new Date(now.getTime() + u.policy!.days * DAY_MS) })
      .onConflictDoNothing();
  }

  const ended = await db
    .select({ lease: instanceLeases, policy: tenants.leasePolicy, status: instances.status, seenAt: instances.seenAt })
    .from(instanceLeases)
    .innerJoin(tenants, eq(tenants.id, instanceLeases.tenantId))
    .innerJoin(instances, and(eq(instances.clusterId, instanceLeases.clusterId), eq(instances.project, instanceLeases.project), eq(instances.name, instanceLeases.name)))
    .where(and(isNotNull(tenants.leasePolicy), lt(instanceLeases.expiresAt, now), or(isNull(instanceLeases.actedAt), lt(instanceLeases.actedAt, instances.seenAt))));
  for (const e of ended) {
    const action = e.policy!.action;
    if (action === "stop" && e.status !== "Running") continue;
    const { clusterId, project, name, tenantId } = e.lease;
    try {
      await enqueueJob(db, {
        type: "lease",
        payload: { clusterId, project, name, action } satisfies LeasePayload as unknown as Record<string, unknown>,
        actor: { type: "system", id: "leases" },
        tenantId,
        clusterIds: [clusterId],
        instanceKey: `${clusterId}/${project}/${name}`,
      });
      // Not again until the inventory has seen the instance after this.
      await db.update(instanceLeases).set({ actedAt: now }).where(at(e.lease));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
  }
}

/** Stops or deletes an instance whose lease ended, unless it was extended meanwhile. */
export function leaseHandler(): JobHandler {
  return async (ctx) => {
    const p = ctx.job.payload as unknown as LeasePayload;
    const k = { clusterId: p.clusterId, project: p.project, name: p.name };
    const lease = await leaseOf(ctx.db, k);
    if (!lease?.expiresAt || lease.expiresAt.getTime() > Date.now()) return { skipped: "the lease was extended or removed" };
    const { client } = await ctx.clientFor(p.clusterId);
    const inst = await readInstance(client, p.project, p.name);
    if (!inst) {
      await forgetLease(ctx.db, k);
      return { skipped: "the instance is gone" };
    }
    if (inst.status === "Running") {
      await ctx.progress({ stage: "stopping" });
      await setState(client, p.project, p.name, "stop");
    }
    if (p.action === "delete") {
      await ctx.progress({ stage: "deleting" });
      await incusDo(client, "DELETE", instancePath(p.project, p.name));
      await forgetLease(ctx.db, k);
    } else {
      await ctx.db.update(instanceLeases).set({ actedAt: new Date() }).where(at(k));
    }
    await refreshInventory(ctx.db, [p.clusterId]);
    return { action: p.action, expiredAt: lease.expiresAt.toISOString() };
  };
}

/** Removing a tenant's policy removes its leases, so a later policy starts them afresh. */
export async function dropTenantLeases(db: Db, tenantId: string): Promise<void> {
  await db.delete(instanceLeases).where(eq(instanceLeases.tenantId, tenantId));
}

/** Leases of a tenant, soonest end first (never-ending last). */
export const tenantLeases = (db: Db, tenantId: string) =>
  db
    .select({ lease: instanceLeases, instanceId: instances.id, status: instances.status })
    .from(instanceLeases)
    .leftJoin(instances, and(eq(instances.clusterId, instanceLeases.clusterId), eq(instances.project, instanceLeases.project), eq(instances.name, instanceLeases.name)))
    .where(eq(instanceLeases.tenantId, tenantId))
    .orderBy(sql`${instanceLeases.expiresAt} asc nulls last`, instanceLeases.name);
