import { eq } from "drizzle-orm";
import { backups, backupTargets } from "../db/schema.ts";
import { ClusterError } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import type { JobContext, JobHandler } from "../jobs/types.ts";
import { readInstance, sourceFacts as readSource, targetFacts as readTarget } from "../mobility/facts.ts";
import { incusDo, instancePath, type MigrateDeps, refreshInventory, setState, TAG_JOB } from "../mobility/migrate-job.ts";
import { preflight } from "../mobility/preflight.ts";
import { transfer as realTransfer } from "../mobility/transfer.ts";
import { waitOp } from "./backup-job.ts";
import { s3StoreFor, type StoreFor } from "./store.ts";

export const TAG_RESTORED_FROM = "user.incuscloud.restored-from";

/**
 * The control plane's own project for restores into restricted projects;
 * nothing in it is ever started and tenants have no access to it.
 */
export const STAGING_PROJECT = "incuscloud-restore";

export interface RestorePayload {
  backupId: string;
  targetClusterId: string;
  targetProject: string;
  targetName: string;
  /** The storage pool; the target project's default profile decides otherwise. */
  pool?: string;
  start: boolean;
}

type Client = Awaited<ReturnType<JobContext["clientFor"]>>["client"];
const isTrue = (v?: string) => ["true", "1", "yes", "on"].includes((v ?? "").toLowerCase());

async function ensureStaging(c: Client) {
  try {
    await c.request("GET", `/1.0/projects/${STAGING_PROJECT}`);
  } catch (e) {
    if (!(e instanceof ClusterError && e.clusterStatus === 404)) throw e;
    // The default project's profiles and networks; its own instances only.
    await c.request("POST", "/1.0/projects", {
      name: STAGING_PROJECT,
      description: "IncusCloud: backups being restored into restricted projects",
      config: { "features.images": "false", "features.profiles": "false", "features.storage.volumes": "false", "features.networks": "false", "user.incuscloud.internal": "restore staging" },
    });
  }
}

/**
 * Restores a backup to any cluster under a free name; an existing instance is
 * never replaced.
 *
 * Unrestricted projects take the backup as an Incus import. Incus 7.5 cannot
 * import into a restricted project (every tenant project): it refuses the
 * backup's server-written `volatile.*` keys, and a local copy from another
 * project loses the on-disk idmap. So a restore into a restricted project is
 * imported into the staging project and migrated in from there, the path P6
 * migrations take, and the staged copy is always removed.
 */
export function restoreHandler(deps: MigrateDeps & { storeFor?: StoreFor } = {}): JobHandler {
  const transfer = deps.transfer ?? realTransfer;
  const sourceFacts = deps.sourceFacts ?? readSource;
  const targetFacts = deps.targetFacts ?? readTarget;

  return async (ctx) => {
    const p = ctx.job.payload as unknown as RestorePayload;
    const storeFor = deps.storeFor ?? s3StoreFor(ctx.secretKey);
    const [row] = await ctx.db.select({ b: backups, t: backupTargets }).from(backups).innerJoin(backupTargets, eq(backupTargets.id, backups.targetId)).where(eq(backups.id, p.backupId));
    if (!row) throw new ApiError(404, "not_found", "The backup no longer exists");
    if (row.b.state !== "ready") throw new ApiError(409, "conflict", `Only a ready backup can be restored (this one is ${row.b.state})`);
    const { client, row: cluster } = await ctx.clientFor(p.targetClusterId);

    await ctx.progress({ stage: "checking" });
    let projectConfig: Record<string, string>;
    try {
      projectConfig = (await client.request<{ config?: Record<string, string> }>("GET", `/1.0/projects/${encodeURIComponent(p.targetProject)}`)).metadata.config ?? {};
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

    /** Streams the backup into an import in `project` named `name`. */
    const importInto = async (project: string, name: string, pool?: string) => {
      const r = await client.upload(`/1.0/instances?project=${encodeURIComponent(project)}`, body, {
        headers: { "X-Incus-name": name, ...(pool && { "X-Incus-pool": pool }) },
        signal: ctx.signal,
      });
      if (r.operation) await waitOp(client, r.operation, ctx.signal);
    };

    try {
      if (!isTrue(projectConfig.restricted)) {
        await ctx.progress({ stage: "restoring" });
        await importInto(p.targetProject, p.targetName, p.pool);
        // Restored: what follows does not undo it.
        await client.request("PATCH", instancePath(p.targetProject, p.targetName), { config: { [TAG_RESTORED_FROM]: p.backupId } });
      } else {
        await restoreViaStaging();
      }
      if (p.start) {
        await ctx.progress({ stage: "starting" });
        await setState(client, p.targetProject, p.targetName, "start");
      }
    } finally {
      await refreshInventory(ctx.db, [p.targetClusterId]);
    }
    return { targetClusterId: p.targetClusterId, targetProject: p.targetProject, targetName: p.targetName };

    async function restoreViaStaging() {
      const c = client;
      const staged = `r-${ctx.job.id.slice(0, 8)}`;
      const target = await targetFacts(c, p.targetProject);
      const rootPool = Object.values(target.defaultProfileDevices).find((d) => d.type === "disk" && d.path === "/")?.pool;
      await ensureStaging(c);
      try {
        await ctx.progress({ stage: "restoring into staging" });
        await importInto(STAGING_PROJECT, staged, p.pool ?? rootPool);
        const source = await sourceFacts(c, STAGING_PROJECT, staged);
        const check = preflight({ source, target, targetName: p.targetName, mode: "copy", live: false, pool: p.pool });
        if (!check.ok) throw new ApiError(409, "preflight_failed", check.problems.join("; "));
        await ctx.progress({ stage: "moving into the project" });
        await transfer({
          src: c,
          dst: c,
          srcProject: STAGING_PROJECT,
          dstProject: p.targetProject,
          name: staged,
          request: { ...check.request, config: { ...check.request.config, [TAG_RESTORED_FROM]: p.backupId, [TAG_JOB]: ctx.job.id } },
          refresh: false,
          live: false,
          instanceOnly: false,
          targetCert: cluster.serverCert,
          transport: "auto",
          signal: ctx.signal,
          onProgress: (message) => ctx.progress({ stage: "moving into the project", message }),
        });
      } catch (e) {
        // A half-made copy this job created goes.
        const copy = await readInstance(c, p.targetProject, p.targetName).catch(() => undefined);
        if (copy?.config?.[TAG_JOB] === ctx.job.id) await incusDo(c, "DELETE", instancePath(p.targetProject, p.targetName)).catch(() => {});
        throw e;
      } finally {
        await incusDo(c, "DELETE", instancePath(STAGING_PROJECT, staged)).catch(() => {});
      }
    }
  };
}
