/** One of a tenant's placements, with what the inventory knows of its cluster. */
export interface Candidate {
  clusterId: string;
  clusterName: string;
  project: string;
  placementStatus: string;
  clusterStatus: string;
  labels: Record<string, string>;
  /** Summed over online members; 0 when the inventory has not read the cluster yet. */
  memoryTotal: number;
  memoryUsed: number;
}

export type Choice = { ok: true; pick: Candidate } | { ok: false; reason: string };

/** Clusters a tenant's instances may be created on: reconciled, even if partly (degraded). */
const USABLE = new Set(["ready", "degraded"]);
const GiB = 1024 ** 3;

/**
 * Where a new instance goes (P9): among the tenant's ready placements on
 * usable clusters, those matching the label selector (or the one named),
 * the cluster with the largest share of memory free after the request.
 * Clusters without inventory yet are kept, last; ties go by name.
 */
export function choose(candidates: Candidate[], request: { memory: number }, opts: { clusterId?: string; labels?: Record<string, string> } = {}): Choice {
  let pool = candidates.filter((c) => c.placementStatus === "ready" && USABLE.has(c.clusterStatus));
  if (opts.clusterId) {
    pool = pool.filter((c) => c.clusterId === opts.clusterId);
    if (!pool.length) return { ok: false, reason: "The tenant is not placed on that cluster" };
  }
  if (!pool.length) return { ok: false, reason: "The tenant is not ready on any cluster" };
  const selector = Object.entries(opts.labels ?? {});
  if (selector.length) {
    pool = pool.filter((c) => selector.every(([k, v]) => c.labels[k] === v));
    if (!pool.length) return { ok: false, reason: `No cluster of the tenant has ${selector.map(([k, v]) => `${k}=${v}`).join(", ")}` };
  }
  const known = pool.filter((c) => c.memoryTotal > 0);
  const fits = known
    .map((c) => ({ c, after: (c.memoryTotal - c.memoryUsed - request.memory) / c.memoryTotal }))
    .filter((x) => x.after >= 0)
    .sort((a, b) => b.after - a.after || a.c.clusterName.localeCompare(b.c.clusterName));
  if (fits.length) return { ok: true, pick: fits[0]!.c };
  const unknown = pool.filter((c) => c.memoryTotal <= 0).sort((a, b) => a.clusterName.localeCompare(b.clusterName));
  if (unknown.length) return { ok: true, pick: unknown[0]! };
  return { ok: false, reason: `No cluster has ${(request.memory / GiB).toFixed(1)} GiB of memory free` };
}
