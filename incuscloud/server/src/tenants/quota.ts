import type { Quotas } from "../db/schema.ts";

/** What a project uses or may use, in Incus's units: counts, CPUs, bytes. */
export type Usage = Record<"instances" | "cpu" | "memory" | "disk", number>;
export type Limits = Partial<Usage>;
type Key = keyof Usage;

const KEYS: Key[] = ["instances", "cpu", "memory", "disk"];
const GiB = 1024 ** 3;
const ZERO: Usage = { instances: 0, cpu: 0, memory: 0, disk: 0 };

/** A tenant's quota in Incus's units (memory and disk are kept in GiB). */
export function quotaBytes(q: Quotas): Limits {
  const out: Limits = {};
  for (const k of KEYS) if (q[k] !== undefined) out[k] = k === "memory" || k === "disk" ? q[k]! * GiB : q[k]!;
  return out;
}

/** Total usage over placements; an unknown usage counts as none. */
export function sumUsage(usages: Array<Usage | null>): Usage {
  const out = { ...ZERO };
  for (const u of usages) if (u) for (const k of KEYS) out[k] += u[k];
  return out;
}

/**
 * Each placement's limits under the tenant's quota (spec D5, elastic split):
 * its own usage plus all of the tenant's free headroom, never below its usage.
 * Keys without a quota get no limit.
 */
export function splitLimits(q: Quotas, usages: Array<Usage | null>): Limits[] {
  const quota = quotaBytes(q);
  const total = sumUsage(usages);
  return usages.map((u) => {
    const own = u ?? ZERO;
    const out: Limits = {};
    for (const k of KEYS) if (quota[k] !== undefined) out[k] = own[k] + Math.max(quota[k]! - total[k], 0);
    return out;
  });
}

const show = (k: Key, n: number) => (k === "memory" || k === "disk" ? (n / GiB).toFixed(1) : String(n));

/** What `request` on top of `used` would exceed: e.g. ["memory: 5.0 of 4 GiB"]. */
export function exceeds(q: Quotas, used: Usage, request: Usage): string[] {
  const quota = quotaBytes(q);
  const out: string[] = [];
  for (const k of KEYS) {
    if (quota[k] === undefined || request[k] === 0) continue;
    const after = used[k] + request[k];
    if (after > quota[k]!) out.push(`${k}: ${show(k, after)} of ${q[k]}${k === "memory" || k === "disk" ? " GiB" : ""}`);
  }
  return out;
}
