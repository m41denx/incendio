import { randomUUID } from "node:crypto";
import { needBackupQuota, needUserQuota } from "../tenants/limits.ts";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { backupPolicies, backups, backupTargets, tenants } from "../db/schema.ts";
import { ClusterError } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import { open } from "../lib/secrets.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { JobContext, JobHandler } from "../jobs/types.ts";
import { instancePath } from "../mobility/migrate-job.ts";
import { readInstance } from "../mobility/facts.ts";
import { objectKey, s3StoreFor, type StoreFor } from "./store.ts";

export type BackupTransport = "auto" | "direct" | "relay";

export interface BackupPayload {
  clusterId: string;
  project: string;
  instanceName: string;
  targetId: string;
  instanceOnly: boolean;
  transport: BackupTransport;
  /** Set for scheduled runs: the policy's retention applies after a success. */
  policyId?: string;
}

type Client = Awaited<ReturnType<JobContext["clientFor"]>>["client"];
type TargetRow = typeof backupTargets.$inferSelect;

/** How long the cluster keeps its own copy if we never get to delete it. */
const CLUSTER_COPY_TTL_MS = 24 * 3600_000;
const POLL_S = 2;
/**
 * Incus releases before 2026-10 ("incusd: Wait for backup uploads to complete")
 * report a direct upload done while its last part is still being sent, and
 * lose its errors: the object is waited for, this long at most.
 */
const DIRECT_WAIT_MS = 120_000;
const mib = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MiB`;

/** Waits for an Incus operation, cancelling it when the job is cancelled. */
export async function waitOp(c: Client, op: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      await c.cancel(op).catch(() => {});
      throw signal.reason;
    }
    const r = await c.request<{ status: string; err: string }>("GET", `${op}/wait?timeout=${POLL_S}`);
    const { status, err } = r.metadata;
    if (status === "Success") return;
    if (status === "Failure" || status === "Cancelled") throw new ClusterError(502, `Cluster: ${err || status}`);
  }
}

/** Removes the policy's ready backups beyond `keep`, oldest first: object, then row. Returns how many went, and any failure. */
export async function pruneBackups(db: Db, policyId: string, keep: number, storeFor: StoreFor): Promise<{ pruned: number; errors: string[] }> {
  const extra = await db
    .select({ b: backups, t: backupTargets })
    .from(backups)
    .innerJoin(backupTargets, eq(backupTargets.id, backups.targetId))
    .where(and(eq(backups.policyId, policyId), eq(backups.state, "ready")))
    .orderBy(desc(backups.createdAt))
    .offset(keep);
  let pruned = 0;
  const errors: string[] = [];
  for (const { b, t } of extra) {
    try {
      await storeFor(t).delete(b.objectKey);
      await db.delete(backups).where(eq(backups.id, b.id));
      pruned++;
    } catch (e) {
      errors.push(`${b.objectKey}: ${(e as Error).message}`);
    }
  }
  return { pruned, errors };
}

/**
 * One backup: the cluster makes an Incus backup, which reaches the target
 * either uploaded by the cluster itself (direct, `backup_s3_upload`) or
 * streamed through the control plane (relay). The cluster's copy is always
 * removed. Scheduled runs then apply their policy's retention.
 */
export function backupHandler(deps: { storeFor?: StoreFor; directWaitMs?: number } = {}): JobHandler {
  const directWaitMs = deps.directWaitMs ?? DIRECT_WAIT_MS;
  return async (ctx) => {
    const p = ctx.job.payload as unknown as BackupPayload;
    const storeFor = deps.storeFor ?? s3StoreFor(ctx.secretKey);
    const [target] = await ctx.db.select().from(backupTargets).where(eq(backupTargets.id, p.targetId));
    if (!target) throw new ApiError(404, "not_found", "The backup target no longer exists");
    if (!target.enabled) throw new ApiError(409, "conflict", `The backup target "${target.name}" is disabled`);
    // The tenant's backup count and storage, and the user's own count (schedules and manual backups alike).
    if (ctx.job.tenantId) {
      const [t] = await ctx.db.select({ quotas: tenants.quotas }).from(tenants).where(eq(tenants.id, ctx.job.tenantId));
      await needBackupQuota(ctx.db, ctx.job.tenantId, t?.quotas ?? {});
      if (ctx.job.actorType === "user" && ctx.job.actorId) await needUserQuota(ctx.db, ctx.job.tenantId, ctx.job.actorId, { backups: 1 });
    }
    const store = storeFor(target);
    const { client } = await ctx.clientFor(p.clusterId);
    const setPolicy = (set: Partial<typeof backupPolicies.$inferInsert>) => (p.policyId ? ctx.db.update(backupPolicies).set(set).where(eq(backupPolicies.id, p.policyId)) : undefined);

    const id = randomUUID();
    const key = objectKey({ prefix: target.prefix, project: p.project, instanceName: p.instanceName, at: new Date(), id });
    const local = `incuscloud-${ctx.job.id.slice(0, 8)}`;
    const backupsPath = (sub = "") => instancePath(p.project, p.instanceName, `/backups${sub}`);
    let rowMade = false;
    const options = { instance_only: p.instanceOnly, optimized_storage: false, compression_algorithm: "gzip" };

    /** Asks the cluster for a backup (uploaded by itself when `s3` is given) and waits for it. */
    const make = async (s3?: TargetRow) => {
      const r = await client.request("POST", backupsPath(), {
        // Incus names nothing (and keeps nothing) when it uploads itself.
        ...(!s3 && { name: local, expires_at: new Date(Date.now() + CLUSTER_COPY_TTL_MS).toISOString() }),
        ...options,
        ...(s3 && { target: { protocol: "s3", url: s3.endpoint, bucket_name: s3.bucket, path: key, access_key: s3.accessKeyId, secret_key: open(ctx.secretKey, s3.secretKeyEnc) } }),
      });
      if (r.operation) await waitOp(client, r.operation, ctx.signal);
    };
    const dropLocal = async () => {
      try {
        await client.request("DELETE", backupsPath(`/${local}`));
      } catch (e) {
        if (!(e instanceof ClusterError && e.clusterStatus === 404)) throw e;
      }
    };
    /** The size of the uploaded object, once it is in the target. */
    const appeared = async () => {
      const end = Date.now() + directWaitMs;
      for (;;) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        const s = await store.stat(key);
        if (s) return s.size;
        if (Date.now() > end) throw new ApiError(502, "target_error", "The cluster reported the upload done, but the object is not in the target");
        await Bun.sleep(Math.min(1000, directWaitMs / 4));
      }
    };
    /** Streams the backup through the control plane: straight from the cluster with `direct_backup`, else made there first, then exported. */
    const relay = async (streaming: boolean) => {
      let stream: ReadableStream<Uint8Array>;
      if (streaming) {
        await ctx.progress({ stage: "backing up and uploading" });
        stream = await client.download(backupsPath(), { method: "POST", body: options, headers: { accept: "application/octet-stream" }, signal: ctx.signal });
      } else {
        await ctx.progress({ stage: "backing up" });
        await make();
        await ctx.progress({ stage: "uploading" });
        stream = await client.download(backupsPath(`/${local}/export`), { signal: ctx.signal });
      }
      let last = 0;
      const { size } = await store.put(key, stream, {
        signal: ctx.signal,
        onBytes: (n) => {
          if (Date.now() - last < 1000) return;
          last = Date.now();
          void ctx.progress({ stage: "uploading", message: `${mib(n)} sent` });
        },
      });
      return size;
    };

    try {
      const inst = await readInstance(client, p.project, p.instanceName);
      if (!inst) throw new ApiError(404, "not_found", `Instance "${p.instanceName}" not found in ${p.project}`);
      await ctx.db.insert(backups).values({
        id,
        tenantId: ctx.job.tenantId,
        policyId: p.policyId ?? null,
        targetId: target.id,
        objectKey: key,
        clusterId: p.clusterId,
        project: p.project,
        instanceName: p.instanceName,
        instanceType: inst.type,
        instanceOnly: p.instanceOnly,
        jobId: ctx.job.id,
        createdBy: `${ctx.job.actorType}:${ctx.job.actorId}`,
      });
      rowMade = true;

      const extensions = (await client.server()).api_extensions ?? [];
      // Incus takes no region for its own uploads and signs them for us-east-1, which a target in
      // another region refuses ("unexpected scope"); those always relay.
      const regionOk = !target.region || target.region === "us-east-1";
      const canDirect = extensions.includes("backup_s3_upload") && regionOk;
      if (p.transport === "direct" && !canDirect) {
        throw new ApiError(409, "conflict", regionOk ? "The cluster cannot upload backups itself (it lacks the backup_s3_upload API extension)" : `The cluster cannot upload to this target itself: Incus signs its uploads for region us-east-1, and the target is in ${target.region}`);
      }
      let transport: "direct" | "relay" | undefined;
      let size: number | null = null;
      if (p.transport !== "relay" && canDirect) {
        try {
          await ctx.progress({ stage: "backing up and uploading" });
          await make(target);
          size = await appeared();
          transport = "direct";
        } catch (e) {
          if (p.transport === "direct" || ctx.signal.aborted) throw e;
          // The cluster may not reach the target: relay instead.
          await store.delete(key).catch(() => {});
          await dropLocal().catch(() => {});
          await ctx.progress({ stage: "relaying", message: `The cluster could not upload it: ${(e as Error).message}` });
        }
      }
      if (!transport) {
        size = await relay(extensions.includes("direct_backup"));
        transport = "relay";
      }

      await ctx.db.update(backups).set({ state: "ready", sizeBytes: size, transport, completedAt: new Date() }).where(eq(backups.id, id));
      let pruned = 0;
      const warnings: string[] = [];
      if (p.policyId) {
        const [policy] = await ctx.db.select().from(backupPolicies).where(eq(backupPolicies.id, p.policyId));
        if (policy) {
          const r = await pruneBackups(ctx.db, policy.id, policy.keep, storeFor);
          pruned = r.pruned;
          warnings.push(...r.errors.map((e) => `Not pruned: ${e}`));
        }
        await setPolicy({ lastSuccessAt: new Date(), lastError: warnings.join("; ") });
      }
      return { backupId: id, transport, sizeBytes: size, pruned, warnings };
    } catch (e) {
      const message = (e as Error).message;
      await store.delete(key).catch(() => {});
      if (rowMade) await ctx.db.update(backups).set({ state: "failed", error: message.slice(0, 1000), completedAt: new Date() }).where(eq(backups.id, id));
      await setPolicy({ lastError: message.slice(0, 1000) });
      throw e;
    } finally {
      await dropLocal().catch(() => {});
    }
  };
}

/** Queues a run for every enabled policy whose interval has passed, unless its instance is busy. */
export async function scheduleBackups(db: Db): Promise<void> {
  const due = await db
    .select()
    .from(backupPolicies)
    .where(and(eq(backupPolicies.enabled, true), or(isNull(backupPolicies.lastRunAt), sql`${backupPolicies.lastRunAt} < now() - make_interval(secs => ${backupPolicies.intervalS})`)));
  for (const p of due) {
    try {
      const payload: BackupPayload = { clusterId: p.clusterId, project: p.project, instanceName: p.instanceName, targetId: p.targetId, instanceOnly: p.instanceOnly, transport: "auto", policyId: p.id };
      const job = await enqueueJob(db, {
        type: "backup",
        payload: payload as unknown as Record<string, unknown>,
        actor: { type: "system", id: "backups" },
        tenantId: p.tenantId,
        clusterIds: [p.clusterId],
        instanceKey: `${p.clusterId}/${p.project}/${p.instanceName}`,
      });
      await db.update(backupPolicies).set({ lastRunAt: new Date(), lastJobId: job.id }).where(eq(backupPolicies.id, p.id));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
  }
}
