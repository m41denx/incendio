import type { InstanceSnapshot, Snapshot } from "../fleet/collect.ts";
import type { balancingPolicies } from "../db/schema.ts";
import type { Guest, Member, PlanInput } from "./engine.ts";

export type Policy = Pick<typeof balancingPolicies.$inferSelect, "method" | "mode" | "balanciness" | "maxMoves" | "allowRestart" | "excludeMembers" | "excludeProjects">;

/** What a cluster without a policy is planned with. */
export const DEFAULT_POLICY: Policy = { method: "memory", mode: "used", balanciness: 10, maxMoves: 5, allowRestart: false, excludeMembers: [], excludeProjects: [] };

const UNITS: Record<string, number> = { "": 1, B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

/** A size as Incus writes it ("1GiB", "512MB", "2048"); a percentage or anything else is unknown. */
export function bytesOf(v: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kMGT]i?B|B)?\s*$/.exec(v);
  if (!m) return null;
  const unit = UNITS[m[2] ?? ""];
  return unit === undefined ? null : Math.round(Number(m[1]) * unit);
}

/** limits.cpu: a count ("2") or a set of CPUs ("0-3", "0,2,4-5"). */
export function cpusOf(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  let n = 0;
  for (const part of s.split(",")) {
    const r = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!r) return null;
    n += r[2] ? Number(r[2]) - Number(r[1]) + 1 : 1;
  }
  return n;
}

const ACTIVE = new Set(["Running"]);

/** Whether a guest can be moved under the policy (see the rebalance job for how). */
function movable(i: InstanceSnapshot, p: Policy): boolean {
  if (p.excludeProjects.includes(i.project)) return false;
  if (i.status === "Stopped") return true;
  if (!ACTIVE.has(i.status)) return false;
  return i.stateful || p.allowRestart;
}

/**
 * The engine's view of a fresh inventory pass. Members that are not online
 * (evacuated, offline) or that the policy excludes are in maintenance. A
 * member's disk is the sum of its pools; its CPU load is the 1-minute load
 * average. Guests' CPU use is the rate the inventory measured (by
 * "project/name"), and what they were assigned comes from their limits,
 * falling back to what they use now and one CPU.
 */
export function modelOf(s: Snapshot, p: Policy, cpuRates: Map<string, number>): Pick<PlanInput, "members" | "guests"> {
  const members: Member[] = s.members.map((m) => {
    const pools = s.pools.filter((x) => x.member === m.name);
    return {
      name: m.name,
      maintenance: m.status !== "Online" || p.excludeMembers.includes(m.name),
      total: { memory: m.memoryTotal, cpu: m.cpuThreads, disk: pools.reduce((n, x) => n + (x.spaceTotal ?? 0), 0) },
      used: { memory: m.memoryUsed, cpu: m.load1 ?? 0, disk: pools.reduce((n, x) => n + (x.spaceUsed ?? 0), 0) },
    };
  });
  const known = new Set(members.map((m) => m.name));
  const guests: Guest[] = s.instances
    .filter((i) => known.has(i.location))
    .map((i) => {
      const running = ACTIVE.has(i.status);
      const memory = running ? (i.memoryUsed ?? 0) : 0;
      const disk = i.diskUsed ?? 0;
      return {
        project: i.project,
        name: i.name,
        member: i.location,
        type: i.type,
        running,
        movable: movable(i, p),
        used: { memory, cpu: running ? (cpuRates.get(`${i.project}/${i.name}`) ?? 0) : 0, disk },
        assigned: { memory: bytesOf(i.limitsMemory) ?? i.memoryUsed ?? 0, cpu: cpusOf(i.limitsCpu) ?? 1, disk },
        hints: i.hints,
      };
    });
  return { members, guests };
}
