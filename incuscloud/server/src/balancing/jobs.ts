import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { balancingPolicies, instances } from "../db/schema.ts";
import { collectInventory } from "../fleet/collect.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { JobContext, JobHandler } from "../jobs/types.ts";
import { waitOp } from "../backups/backup-job.ts";
import { instancePath, refreshInventory, setState } from "../mobility/migrate-job.ts";
import { type Move, plan, type Plan } from "./engine.ts";
import { DEFAULT_POLICY, modelOf, type Policy } from "./model.ts";

type Client = Awaited<ReturnType<JobContext["clientFor"]>>["client"];

export interface RebalancePayload {
  clusterId: string;
}
export interface MemberPayload {
  clusterId: string;
  member: string;
  /** Evacuation only: Incus's cluster.evacuate values. */
  mode?: EvacuateMode;
}
export const EVACUATE_MODES = ["auto", "migrate", "live-migrate", "stop"] as const;
export type EvacuateMode = (typeof EVACUATE_MODES)[number];

export type MoveOutcome = Move & { outcome: "moved" | "skipped" | "failed"; detail?: string };
export interface RebalanceResult {
  before: number;
  after: number;
  moves: MoveOutcome[];
  notes: string[];
}

/** The cluster's policy, or the defaults when it has none. */
export async function policyOf(db: Db, clusterId: string): Promise<Policy> {
  const [p] = await db.select().from(balancingPolicies).where(eq(balancingPolicies.clusterId, clusterId));
  return p ?? DEFAULT_POLICY;
}

/** A plan from a fresh read of the cluster (CPU rates from the inventory), with what was read. */
export async function planCluster(db: Db, client: Pick<Client, "request">, clusterId: string, policy: Policy) {
  const snap = await collectInventory(client);
  if (!snap.clustered) throw new ApiError(409, "not_a_cluster", "This is a standalone server, not a cluster: there is nothing to balance between");
  const rates = await db.select({ project: instances.project, name: instances.name, cpuCores: instances.cpuCores }).from(instances).where(eq(instances.clusterId, clusterId));
  const model = modelOf(snap, policy, new Map(rates.filter((r) => r.cpuCores != null).map((r) => [`${r.project}/${r.name}`, r.cpuCores!])));
  const result: Plan = plan({ ...model, method: policy.method, mode: policy.mode, balanciness: policy.balanciness, maxMoves: policy.maxMoves });
  const restartOnly = snap.instances.filter((i) => i.status === "Running" && !i.stateful && !policy.allowRestart && !policy.excludeProjects.includes(i.project)).length;
  if (restartOnly) result.notes.push(`${restartOnly} running instances can only move with a restart, which the policy does not allow`);
  return { plan: result, snapshot: snap };
}

interface IncusInstanceNow {
  location: string;
  status: string;
  type: string;
  expanded_config?: Record<string, string>;
}

/**
 * Moves one instance to another member with Incus's own same-cluster move,
 * after checking it is still where and as it was planned: a VM that can move
 * live moves live, a stopped one as it is, a running one is stopped, moved
 * and started (the plan only holds those when the policy allows restarts).
 * A failed move starts the instance again where it is.
 */
async function moveOne(c: Client, mv: Move, wasRunning: boolean, allowRestart: boolean): Promise<MoveOutcome> {
  const now = (await c.request<IncusInstanceNow>("GET", instancePath(mv.project, mv.name))).metadata;
  if (now.location !== mv.from) return { ...mv, outcome: "skipped", detail: `now on ${now.location}` };
  const running = now.status === "Running";
  if (running !== wasRunning || (now.status !== "Running" && now.status !== "Stopped")) return { ...mv, outcome: "skipped", detail: `${now.status.toLowerCase()} since planned` };
  const live = running && now.type === "virtual-machine" && now.expanded_config?.["migration.stateful"] === "true";
  if (running && !live && !allowRestart) return { ...mv, outcome: "skipped", detail: "would need a restart" };
  const restart = running && !live;
  const never = new AbortController().signal;
  try {
    if (restart) await setState(c, mv.project, mv.name, "stop");
    const r = await c.request("POST", `${instancePath(mv.project, mv.name)}&target=${encodeURIComponent(mv.to)}`, { name: mv.name, migration: true, live });
    // A move is not cancelled half way: cancelling the job stops between moves.
    if (r.type === "async" && r.operation) await waitOp(c, r.operation, never);
  } catch (e) {
    if (restart) await setState(c, mv.project, mv.name, "start").catch(() => {});
    return { ...mv, outcome: "failed", detail: (e as Error).message };
  }
  if (restart) await setState(c, mv.project, mv.name, "start").catch(() => {});
  const after = (await c.request<IncusInstanceNow>("GET", instancePath(mv.project, mv.name))).metadata;
  if (after.location !== mv.to) return { ...mv, outcome: "failed", detail: `still on ${after.location}` };
  return { ...mv, outcome: "moved" };
}

/** Plans the cluster afresh and carries the plan out, one move at a time. */
export function rebalanceHandler(): JobHandler {
  return async (ctx) => {
    const p = ctx.job.payload as unknown as RebalancePayload;
    const setPolicy = (v: Partial<typeof balancingPolicies.$inferInsert>) => ctx.db.update(balancingPolicies).set({ lastRunAt: new Date(), lastJobId: ctx.job.id, ...v }).where(eq(balancingPolicies.clusterId, p.clusterId));
    try {
      const { client } = await ctx.clientFor(p.clusterId);
      const policy = await policyOf(ctx.db, p.clusterId);
      await ctx.progress({ stage: "planning" });
      const { plan: planned, snapshot } = await planCluster(ctx.db, client, p.clusterId, policy);
      const running = new Map(snapshot.instances.map((i) => [`${i.project}/${i.name}`, i.status === "Running"]));
      const moves: MoveOutcome[] = [];
      for (const [n, mv] of planned.moves.entries()) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        await ctx.progress({ stage: "moving", percent: Math.round((n / planned.moves.length) * 100), message: `${mv.project}/${mv.name} → ${mv.to}` });
        moves.push(await moveOne(client, mv, running.get(`${mv.project}/${mv.name}`) ?? false, policy.allowRestart));
      }
      if (moves.length) await refreshInventory(ctx.db, [p.clusterId]);
      const failed = moves.filter((m) => m.outcome === "failed");
      await setPolicy({ lastSuccessAt: new Date(), lastError: failed.length ? `${failed.length} of ${moves.length} moves failed: ${failed.map((f) => `${f.name}: ${f.detail}`).join("; ")}`.slice(0, 1000) : "" });
      const result: RebalanceResult = { before: planned.before, after: planned.after, moves, notes: planned.notes };
      return result as unknown as Record<string, unknown>;
    } catch (e) {
      if (!ctx.signal.aborted) await setPolicy({ lastError: (e as Error).message.slice(0, 1000) });
      throw e;
    }
  };
}

async function memberState(ctx: JobContext, action: "evacuate" | "restore") {
  const p = ctx.job.payload as unknown as MemberPayload;
  const { client } = await ctx.clientFor(p.clusterId);
  await ctx.progress({ stage: action === "evacuate" ? "evacuating" : "restoring", message: p.member });
  const r = await client.request("POST", `/1.0/cluster/members/${encodeURIComponent(p.member)}/state`, { action, ...(action === "evacuate" && p.mode && { mode: p.mode }) });
  if (r.type === "async" && r.operation) await waitOp(client, r.operation, ctx.signal);
  await refreshInventory(ctx.db, [p.clusterId]);
  return { member: p.member, action };
}

/** Puts a member into maintenance: Incus moves or stops its instances (cluster.evacuate, or the mode given). */
export const evacuateHandler = (): JobHandler => (ctx) => memberState(ctx, "evacuate");
/** Brings an evacuated member back, and the instances that left it. */
export const restoreMemberHandler = (): JobHandler => (ctx) => memberState(ctx, "restore");

/** Enqueues a rebalance for every enabled policy that is due; one per cluster at a time. */
export async function scheduleBalancing(db: Db): Promise<void> {
  const due = await db
    .select()
    .from(balancingPolicies)
    .where(and(eq(balancingPolicies.enabled, true), or(isNull(balancingPolicies.lastRunAt), sql`${balancingPolicies.lastRunAt} < now() - make_interval(secs => ${balancingPolicies.intervalS})`)));
  for (const p of due) {
    try {
      const job = await enqueueJob(db, {
        type: "rebalance",
        payload: { clusterId: p.clusterId },
        actor: { type: "system", id: "balancing" },
        tenantId: null,
        clusterIds: [p.clusterId],
        instanceKey: `rebalance:${p.clusterId}`,
      });
      await db.update(balancingPolicies).set({ lastRunAt: new Date(), lastJobId: job.id }).where(eq(balancingPolicies.clusterId, p.clusterId));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
  }
}
