import { eq } from "drizzle-orm";
import { backups, backupTargets } from "../db/schema.ts";
import { ClusterError } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import type { JobHandler } from "../jobs/types.ts";
import { readInstance } from "../mobility/facts.ts";
import { instancePath, refreshInventory, setState } from "../mobility/migrate-job.ts";
import { waitOp } from "./backup-job.ts";
import { s3StoreFor, type StoreFor } from "./store.ts";

export const TAG_RESTORED_FROM = "user.incuscloud.restored-from";

export interface RestorePayload {
  backupId: string;
  targetClusterId: string;
  targetProject: string;
  targetName: string;
  /** The storage pool; the target project's default profile decides otherwise. */
  pool?: string;
  start: boolean;
}

/**
 * Restores a backup to any cluster: checks the project and the name, then
 * streams the object from its target into an Incus import. An existing
 * instance is never replaced; a failed import is cleaned up by Incus.
 */
export function restoreHandler(deps: { storeFor?: StoreFor } = {}): JobHandler {
  return async (ctx) => {
    const p = ctx.job.payload as unknown as RestorePayload;
    const storeFor = deps.storeFor ?? s3StoreFor(ctx.secretKey);
    const [row] = await ctx.db.select({ b: backups, t: backupTargets }).from(backups).innerJoin(backupTargets, eq(backupTargets.id, backups.targetId)).where(eq(backups.id, p.backupId));
    if (!row) throw new ApiError(404, "not_found", "The backup no longer exists");
    if (row.b.state !== "ready") throw new ApiError(409, "conflict", `Only a ready backup can be restored (this one is ${row.b.state})`);
    const { client } = await ctx.clientFor(p.targetClusterId);

    await ctx.progress({ stage: "checking" });
    try {
      await client.request("GET", `/1.0/projects/${encodeURIComponent(p.targetProject)}`);
    } catch (e) {
      if (e instanceof ClusterError && e.clusterStatus === 404) throw new ApiError(409, "conflict", `Project "${p.targetProject}" does not exist on the target cluster`);
      throw e;
    }
    if (await readInstance(client, p.targetProject, p.targetName)) throw new ApiError(409, "conflict", `An instance named "${p.targetName}" already exists in ${p.targetProject} on the target; it is not overwritten`);
    if (ctx.signal.aborted) throw ctx.signal.reason;

    let body: ReadableStream<Uint8Array>;
    try {
      body = await storeFor(row.t).get(row.b.objectKey);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw new ApiError(409, "conflict", `The backup is not in its target any more (${row.b.objectKey})`);
      throw e;
    }

    await ctx.progress({ stage: "restoring" });
    const r = await client.upload(`/1.0/instances?project=${encodeURIComponent(p.targetProject)}`, body, {
      headers: { "X-Incus-name": p.targetName, ...(p.pool && { "X-Incus-pool": p.pool }) },
      signal: ctx.signal,
    });
    if (r.operation) await waitOp(client, r.operation, ctx.signal);

    // Restored: what follows does not undo it.
    await client.request("PATCH", instancePath(p.targetProject, p.targetName), { config: { [TAG_RESTORED_FROM]: p.backupId } });
    if (p.start) {
      await ctx.progress({ stage: "starting" });
      await setState(client, p.targetProject, p.targetName, "start");
    }
    await refreshInventory(ctx.db, [p.targetClusterId]);
    return { targetClusterId: p.targetClusterId, targetProject: p.targetProject, targetName: p.targetName };
  };
}
