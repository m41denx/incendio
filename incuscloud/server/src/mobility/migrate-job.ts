import { inArray } from "drizzle-orm";
import { actorOf, carryOwner, recordOwner } from "../acl/owners.ts";
import { clusters } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import type { IncusAdminClient } from "../incus/admin-client.ts";
import type { JobHandler } from "../jobs/types.ts";
import { readInstance, sourceFacts as readSource, targetFacts as readTarget } from "./facts.ts";
import { preflight } from "./preflight.ts";
import { transfer as realTransfer, type TransferOptions } from "./transfer.ts";

export interface MigratePayload {
  sourceClusterId: string;
  sourceProject: string;
  name: string;
  targetClusterId: string;
  targetProject: string;
  targetName: string;
  mode: "copy" | "move";
  live: boolean;
  pool?: string;
  transport: "auto" | "direct" | "relay";
}

export interface MigrateDeps {
  transfer?: (o: TransferOptions) => Promise<{ transport: "direct" | "relay" }>;
  sourceFacts?: typeof readSource;
  targetFacts?: typeof readTarget;
}

type Client = Pick<IncusAdminClient, "request" | "wait">;

/** A request that may answer with an operation; waits for it. */
export async function incusDo(c: Client, method: string, path: string, body?: unknown) {
  const r = await c.request(method, path, body);
  if (r.type === "async" && r.operation) await c.wait(r.operation);
}
export const instancePath = (project: string, name: string, sub = "") => `/1.0/instances/${encodeURIComponent(name)}${sub}?project=${encodeURIComponent(project)}`;
export const setState = (c: Client, project: string, name: string, action: "start" | "stop") => incusDo(c, "PUT", instancePath(project, name, "/state"), { action, timeout: 60, force: action === "stop" });

/** Marks what IncusCloud created, so that it only ever removes its own instances (spec §5). */
export const TAG_JOB = "user.incuscloud.job";
export const TAG_MIGRATED_FROM = "user.incuscloud.migrated-from";

/** Asks the fleet worker to read these clusters again on its next pass. */
export const refreshInventory = (db: Parameters<JobHandler>[0]["db"], ids: string[]) => db.update(clusters).set({ inventoryAt: null }).where(inArray(clusters.id, ids));

/**
 * Copies or moves an instance to another cluster. A move copies, starts the
 * copy if the source was running, and only then deletes the source; until
 * that delete, any failure or cancel removes the copy this job made and
 * restarts the source if the job stopped it.
 */
export function migrateHandler(deps: MigrateDeps = {}): JobHandler {
  const transfer = deps.transfer ?? realTransfer;
  const sourceFacts = deps.sourceFacts ?? readSource;
  const targetFacts = deps.targetFacts ?? readTarget;

  return async (ctx) => {
    const p = ctx.job.payload as unknown as MigratePayload;
    const [src, dst] = await Promise.all([ctx.clientFor(p.sourceClusterId), ctx.clientFor(p.targetClusterId)]);

    await ctx.progress({ stage: "checking" });
    const [source, target] = await Promise.all([sourceFacts(src.client, p.sourceProject, p.name), targetFacts(dst.client, p.targetProject)]);
    const check = preflight({ source, target, targetName: p.targetName, mode: p.mode, live: p.live, pool: p.pool });
    if (!check.ok) throw new ApiError(409, "preflight_failed", check.problems.join("; "));
    const request = { ...check.request, config: { ...check.request.config, [TAG_JOB]: ctx.job.id, [TAG_MIGRATED_FROM]: `${p.sourceClusterId}/${p.sourceProject}/${p.name}` } };

    const wasRunning = source.status === "Running";
    let stoppedSource = false;
    let committed = false;
    let transport: "direct" | "relay" = "direct";
    try {
      if (p.mode === "move" && wasRunning && !p.live) {
        await ctx.progress({ stage: "stopping the source" });
        await setState(src.client, p.sourceProject, p.name, "stop");
        stoppedSource = true;
      }
      await ctx.progress({ stage: "transferring" });
      ({ transport } = await transfer({
        src: src.client,
        dst: dst.client,
        srcProject: p.sourceProject,
        dstProject: p.targetProject,
        name: p.name,
        request,
        refresh: false,
        live: p.live,
        instanceOnly: false,
        targetCert: dst.row.serverCert,
        transport: p.transport,
        signal: ctx.signal,
        onProgress: (message) => ctx.progress({ stage: "transferring", message }),
      }));

      await ctx.progress({ stage: "verifying" });
      const copy = await readInstance(dst.client, p.targetProject, p.targetName);
      if (!copy || copy.type !== source.type) throw new ApiError(502, "migration_failed", "The copy is missing on the target after the transfer");
      if (p.mode === "move" && wasRunning && !p.live && copy.status !== "Running") {
        await ctx.progress({ stage: "starting the copy" });
        await setState(dst.client, p.targetProject, p.targetName, "start");
      }
      if (p.mode === "move") {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        committed = true; // past this point the source is going away: no rollback, no cancel
        await ctx.progress({ stage: "deleting the source" });
        await incusDo(src.client, "DELETE", instancePath(p.sourceProject, p.name));
      }
      // A move keeps its owner; a copy is whoever made it.
      const from = { clusterId: p.sourceClusterId, project: p.sourceProject, name: p.name };
      const to = { clusterId: p.targetClusterId, project: p.targetProject, name: p.targetName };
      const actor = actorOf(ctx.job);
      if (p.mode === "move") await carryOwner(ctx.db, from, to, { move: true });
      else if (actor) await recordOwner(ctx.db, to, actor, "incuscloud");
    } catch (e) {
      if (!committed) {
        await ctx.progress({ stage: "rolling back" });
        const copy = await readInstance(dst.client, p.targetProject, p.targetName).catch(() => undefined);
        if (copy?.config?.[TAG_JOB] === ctx.job.id) {
          if (copy.status === "Running") await setState(dst.client, p.targetProject, p.targetName, "stop").catch(() => {});
          await incusDo(dst.client, "DELETE", instancePath(p.targetProject, p.targetName)).catch(() => {});
        }
        if (stoppedSource) await setState(src.client, p.sourceProject, p.name, "start").catch(() => {});
      }
      throw e;
    } finally {
      await refreshInventory(ctx.db, [p.sourceClusterId, p.targetClusterId]);
    }
    return { transport, targetClusterId: p.targetClusterId, targetProject: p.targetProject, targetName: p.targetName };
  };
}
