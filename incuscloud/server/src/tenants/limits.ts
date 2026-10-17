import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { backups, instanceOwners, instances, jobs, k8sClusters, placements, userQuotas, type Quotas, type UserQuotas } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";

/**
 * Permissions phase 4's quotas, beside the tenant's pool (quota.ts):
 * per-instance maximums, backups, Kubernetes clusters, and users' shares
 * inside a tenant. Unset means unlimited.
 */
const GiB = 1024 ** 3;
const over = (msg: string[]) => {
  if (msg.length) throw new ApiError(409, "quota_exceeded", `Over the quota: ${msg.join(", ")}`);
};

/** An instance's size against the tenant's per-instance maximums (cores, bytes). */
export function needInstanceCaps(q: Quotas, size: { cpu: number; memory: number; disk: number }): void {
  const msg: string[] = [];
  if (q.maxInstanceCpu !== undefined && size.cpu > q.maxInstanceCpu) msg.push(`${size.cpu} cores per instance, at most ${q.maxInstanceCpu}`);
  if (q.maxInstanceMemory !== undefined && size.memory > q.maxInstanceMemory * GiB) msg.push(`${(size.memory / GiB).toFixed(1)} GiB of memory per instance, at most ${q.maxInstanceMemory}`);
  if (q.maxInstanceDisk !== undefined && size.disk > q.maxInstanceDisk * GiB) msg.push(`${(size.disk / GiB).toFixed(1)} GiB of disk per instance, at most ${q.maxInstanceDisk}`);
  over(msg);
}

/** Incus sizes ("2GiB", "512MB", "1073741824") as bytes; 0 when absent or relative. */
export function bytesOf(v: string | null | undefined): number {
  const m = String(v ?? "").match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i?B?)?$/i);
  if (!m) return 0;
  const unit = (m[2] ?? "").toUpperCase();
  const pow = "KMGTP".indexOf(unit[0] ?? "") + 1;
  return Math.round(Number(m[1]) * (unit.includes("I") ? 1024 : 1000) ** pow);
}

export async function userQuotaOf(db: Db, tenantId: string, userId: string): Promise<UserQuotas> {
  const [r] = await db.select({ q: userQuotas.quotas }).from(userQuotas).where(and(eq(userQuotas.tenantId, tenantId), eq(userQuotas.userId, userId)));
  return r?.q ?? {};
}

/** What a user owns in a tenant: instances (with their cpu and memory limits) and creates still running, and backups they made. */
export async function userUsage(db: Db, tenantId: string, userId: string): Promise<Required<UserQuotas>> {
  const owned = await db
    .select({ cpu: instances.limitsCpu, memory: instances.limitsMemory })
    .from(instanceOwners)
    .innerJoin(instances, and(eq(instances.clusterId, instanceOwners.clusterId), eq(instances.project, instanceOwners.project), eq(instances.name, instanceOwners.name)))
    .innerJoin(placements, and(eq(placements.clusterId, instances.clusterId), eq(placements.project, instances.project)))
    .where(and(eq(instanceOwners.userId, userId), eq(placements.tenantId, tenantId)));
  const pending = await db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.type, "create"), eq(jobs.tenantId, tenantId), eq(jobs.actorType, "user"), eq(jobs.actorId, userId), inArray(jobs.state, ["queued", "running"])));
  const [b] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(backups)
    .where(and(eq(backups.tenantId, tenantId), eq(backups.createdBy, `user:${userId}`), sql`${backups.state} <> 'failed'`));
  const cpu = owned.reduce((a, i) => a + (Number(i.cpu) || 0), 0) + pending.reduce((a, j) => a + (Number((j.payload as { cpu?: number }).cpu) || 0), 0);
  const memory = owned.reduce((a, i) => a + bytesOf(i.memory), 0) + pending.reduce((a, j) => a + (Number((j.payload as { memory?: number }).memory) || 0), 0);
  return { instances: owned.length + pending.length, cpu, memory, backups: b?.n ?? 0 };
}

/** A user's create (or backup) against their share inside the tenant. */
export async function needUserQuota(db: Db, tenantId: string, userId: string, req: Partial<Required<UserQuotas>>): Promise<void> {
  const q = await userQuotaOf(db, tenantId, userId);
  if (!Object.keys(q).length) return;
  const used = await userUsage(db, tenantId, userId);
  const msg: string[] = [];
  for (const k of ["instances", "cpu", "backups"] as const) if (q[k] !== undefined && req[k] && used[k] + req[k]! > q[k]!) msg.push(`your ${k}: ${used[k] + req[k]!} of ${q[k]}`);
  if (q.memory !== undefined && req.memory && used.memory + req.memory > q.memory * GiB) msg.push(`your memory: ${((used.memory + req.memory) / GiB).toFixed(1)} of ${q.memory} GiB`);
  over(msg);
}

/** A new backup against the tenant's backup count and bytes. */
export async function needBackupQuota(db: Db, tenantId: string | null, q: Quotas): Promise<void> {
  if (!tenantId || (q.backups === undefined && q.backupGiB === undefined)) return;
  const [r] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number), bytes: sql<number>`coalesce(sum(${backups.sizeBytes}), 0)`.mapWith(Number) })
    .from(backups)
    .where(and(eq(backups.tenantId, tenantId), sql`${backups.state} <> 'failed'`));
  const msg: string[] = [];
  if (q.backups !== undefined && (r?.n ?? 0) + 1 > q.backups) msg.push(`backups: ${q.backups} already`);
  if (q.backupGiB !== undefined && (r?.bytes ?? 0) >= q.backupGiB * GiB) msg.push(`backup storage: ${((r?.bytes ?? 0) / GiB).toFixed(1)} of ${q.backupGiB} GiB`);
  over(msg);
}

/** A new Kubernetes cluster against the tenant's count. */
export async function needKubernetesQuota(db: Db, tenantId: string, q: Quotas): Promise<void> {
  if (q.kubernetes === undefined) return;
  const [r] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(k8sClusters).where(eq(k8sClusters.tenantId, tenantId));
  if ((r?.n ?? 0) + 1 > q.kubernetes) over([`Kubernetes clusters: ${q.kubernetes} already`]);
}
