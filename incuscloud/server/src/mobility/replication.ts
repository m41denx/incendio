import { and, eq, isNull, or, sql } from "drizzle-orm";
import { carryOwner } from "../acl/owners.ts";
import type { Db } from "../db/index.ts";
import { replicationPolicies } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { JobContext, JobHandler } from "../jobs/types.ts";
import { readInstance, sourceFacts as readSource, targetFacts as readTarget } from "./facts.ts";
import { incusDo, instancePath, refreshInventory, setState, TAG_JOB, type MigrateDeps } from "./migrate-job.ts";
import { preflight } from "./preflight.ts";
import { transfer as realTransfer } from "./transfer.ts";

/** Marks a replica with the policy that keeps it; a refresh only ever touches its own. */
export const TAG_REPLICA_OF = "user.incuscloud.replica-of";
export const TAG_PROMOTED_FROM = "user.incuscloud.promoted-from";

type Policy = typeof replicationPolicies.$inferSelect;
export const policyInstanceKey = (p: Pick<Policy, "sourceClusterId" | "sourceProject" | "instanceName">) => `${p.sourceClusterId}/${p.sourceProject}/${p.instanceName}`;

async function loadPolicy(ctx: JobContext): Promise<Policy> {
  const { policyId } = ctx.job.payload as { policyId: string };
  const [p] = await ctx.db.select().from(replicationPolicies).where(eq(replicationPolicies.id, policyId));
  if (!p) throw new ApiError(404, "not_found", "The replication policy no longer exists");
  return p;
}

/**
 * One replication run: the first copies the instance (stopped, tagged with
 * the policy); later runs refresh that copy with what changed. An instance of
 * the same name that is not this policy's replica is never touched.
 */
export function replicateHandler(deps: MigrateDeps = {}): JobHandler {
  const transfer = deps.transfer ?? realTransfer;
  const sourceFacts = deps.sourceFacts ?? readSource;
  const targetFacts = deps.targetFacts ?? readTarget;

  return async (ctx) => {
    const p = await loadPolicy(ctx);
    const [src, dst] = await Promise.all([ctx.clientFor(p.sourceClusterId), ctx.clientFor(p.targetClusterId)]);
    let existing: Awaited<ReturnType<typeof readInstance>>;
    try {
      await ctx.progress({ stage: "checking" });
      existing = await readInstance(dst.client, p.targetProject, p.targetName);
      if (existing && existing.config?.[TAG_REPLICA_OF] !== p.id) throw new ApiError(409, "conflict", `A different instance named "${p.targetName}" exists on the target; it is not overwritten`);
      const [source, target] = await Promise.all([sourceFacts(src.client, p.sourceProject, p.instanceName), targetFacts(dst.client, p.targetProject)]);
      // The replica's own name is expected on the target once it exists.
      const facts = existing ? { ...target, instanceNames: target.instanceNames.filter((n) => n !== p.targetName) } : target;
      const check = preflight({ source, target: facts, targetName: p.targetName, mode: "copy", live: false });
      if (!check.ok) throw new ApiError(409, "preflight_failed", check.problems.join("; "));
      const config = { ...check.request.config, [TAG_REPLICA_OF]: p.id, ...(existing ? {} : { [TAG_JOB]: ctx.job.id }) };

      await ctx.progress({ stage: existing ? "refreshing" : "copying" });
      const { transport } = await transfer({
        src: src.client,
        dst: dst.client,
        srcProject: p.sourceProject,
        dstProject: p.targetProject,
        name: p.instanceName,
        request: { ...check.request, config },
        refresh: !!existing,
        live: false,
        instanceOnly: false,
        targetCert: dst.row.serverCert,
        transport: "auto",
        signal: ctx.signal,
        onProgress: (message) => ctx.progress({ stage: existing ? "refreshing" : "copying", message }),
      });
      await ctx.db.update(replicationPolicies).set({ lastSuccessAt: new Date(), lastError: "" }).where(eq(replicationPolicies.id, p.id));
      // The replica is the source's owner's, as the instance it stands in for.
      if (!existing) await carryOwner(ctx.db, { clusterId: p.sourceClusterId, project: p.sourceProject, name: p.instanceName }, { clusterId: p.targetClusterId, project: p.targetProject, name: p.targetName });
      return { transport, refreshed: !!existing };
    } catch (e) {
      // A first copy this run left behind goes; an existing replica stays as it was.
      if (!existing) {
        const left = await readInstance(dst.client, p.targetProject, p.targetName).catch(() => undefined);
        if (left?.config?.[TAG_JOB] === ctx.job.id) await incusDo(dst.client, "DELETE", instancePath(p.targetProject, p.targetName)).catch(() => {});
      }
      await ctx.db
        .update(replicationPolicies)
        .set({ lastError: (e as Error).message.slice(0, 1000) })
        .where(eq(replicationPolicies.id, p.id));
      throw e;
    } finally {
      await refreshInventory(ctx.db, [p.targetClusterId]);
    }
  };
}

/**
 * Fails over to the replica: optionally stops the source (best effort: it may
 * be the cluster that is gone), makes the replica an ordinary instance and
 * starts it. The policy stops replicating.
 */
export function failoverHandler(): JobHandler {
  return async (ctx) => {
    const p = await loadPolicy(ctx);
    const { stopSource } = ctx.job.payload as { stopSource?: boolean };
    if (p.state !== "active") throw new ApiError(409, "conflict", "This policy has already failed over");
    const dst = await ctx.clientFor(p.targetClusterId);
    const replica = await readInstance(dst.client, p.targetProject, p.targetName);
    if (!replica || replica.config?.[TAG_REPLICA_OF] !== p.id) throw new ApiError(409, "conflict", "There is no replica to fail over to");

    const warnings: string[] = [];
    if (stopSource) {
      await ctx.progress({ stage: "stopping the source" });
      try {
        const src = await ctx.clientFor(p.sourceClusterId);
        const original = await readInstance(src.client, p.sourceProject, p.instanceName);
        if (original?.status === "Running") await setState(src.client, p.sourceProject, p.instanceName, "stop");
      } catch (e) {
        warnings.push(`The source could not be stopped: ${(e as Error).message}`);
      }
    }

    await ctx.progress({ stage: "promoting the replica" });
    const { [TAG_REPLICA_OF]: _, [TAG_JOB]: __, ...config } = replica.config;
    const r = replica as typeof replica & { ephemeral?: boolean; stateful?: boolean; description?: string };
    await incusDo(dst.client, "PUT", instancePath(p.targetProject, p.targetName), {
      architecture: r.architecture,
      config: { ...config, [TAG_PROMOTED_FROM]: policyInstanceKey(p) },
      devices: r.devices,
      profiles: r.profiles,
      ephemeral: r.ephemeral ?? false,
      stateful: r.stateful ?? false,
      description: r.description ?? "",
    });
    await ctx.progress({ stage: "starting the replica" });
    if (replica.status !== "Running") await setState(dst.client, p.targetProject, p.targetName, "start");
    await ctx.db.update(replicationPolicies).set({ state: "failed-over", enabled: false }).where(eq(replicationPolicies.id, p.id));
    await refreshInventory(ctx.db, [p.sourceClusterId, p.targetClusterId]);
    return { targetClusterId: p.targetClusterId, targetProject: p.targetProject, targetName: p.targetName, warnings };
  };
}

/** Queues a run for every enabled, active policy whose interval has passed, unless its instance is busy. */
export async function scheduleReplication(db: Db): Promise<void> {
  const due = await db
    .select()
    .from(replicationPolicies)
    .where(
      and(
        eq(replicationPolicies.enabled, true),
        eq(replicationPolicies.state, "active"),
        or(isNull(replicationPolicies.lastRunAt), sql`${replicationPolicies.lastRunAt} < now() - make_interval(secs => ${replicationPolicies.intervalS})`),
      ),
    );
  for (const p of due) {
    try {
      const job = await enqueueJob(db, {
        type: "replicate",
        payload: { policyId: p.id },
        actor: { type: "system", id: "replication" },
        tenantId: p.tenantId,
        clusterIds: [p.sourceClusterId, p.targetClusterId],
        instanceKey: policyInstanceKey(p),
      });
      await db.update(replicationPolicies).set({ lastRunAt: new Date(), lastJobId: job.id }).where(eq(replicationPolicies.id, p.id));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
  }
}
