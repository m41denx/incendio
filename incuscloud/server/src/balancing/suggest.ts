/**
 * Cross-cluster suggestions: for a tenant placed on several clusters, when
 * its hottest cluster's memory use exceeds its coolest's by more than the
 * threshold (percentage points), its largest running instances on the hot
 * one are suggested for a move to the cool one, while each move narrows the
 * gap and until it is within the threshold. Nothing moves on its own: the
 * UI offers a migration (P6) for each.
 */

export interface SuggestInput {
  threshold: number;
  clusters: Array<{ id: string; name: string; memoryTotal: number; memoryUsed: number }>;
  placements: Array<{ tenantId: string; tenantSlug: string; clusterId: string; project: string }>;
  instances: Array<{ id: string; clusterId: string; project: string; name: string; status: string; memoryUsed: number | null }>;
}

export interface Suggestion {
  tenantId: string;
  tenantSlug: string;
  instanceId: string;
  project: string;
  name: string;
  memoryBytes: number;
  fromClusterId: string;
  fromClusterName: string;
  toClusterId: string;
  toClusterName: string;
  /** The tenant's project on the target cluster. */
  toProject: string;
  reason: string;
}

/** At most this many suggestions per tenant. */
const PER_TENANT = 5;

export function suggest(input: SuggestInput): Suggestion[] {
  const clusters = new Map(input.clusters.filter((c) => c.memoryTotal > 0).map((c) => [c.id, c]));
  const pct = (used: number, total: number) => (used / total) * 100;
  const byTenant = new Map<string, SuggestInput["placements"]>();
  for (const p of input.placements) if (clusters.has(p.clusterId)) byTenant.set(p.tenantId, [...(byTenant.get(p.tenantId) ?? []), p]);

  const out: Suggestion[] = [];
  for (const [tenantId, places] of [...byTenant.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (places.length < 2) continue;
    const ranked = [...places].sort((a, b) => {
      const ca = clusters.get(a.clusterId)!;
      const cb = clusters.get(b.clusterId)!;
      return pct(cb.memoryUsed, cb.memoryTotal) - pct(ca.memoryUsed, ca.memoryTotal) || a.clusterId.localeCompare(b.clusterId);
    });
    const hotP = ranked[0]!;
    const coolP = ranked[ranked.length - 1]!;
    const hot = clusters.get(hotP.clusterId)!;
    const cool = clusters.get(coolP.clusterId)!;
    let hotUsed = hot.memoryUsed;
    let coolUsed = cool.memoryUsed;
    const gap = () => pct(hotUsed, hot.memoryTotal) - pct(coolUsed, cool.memoryTotal);
    if (gap() <= input.threshold) continue;
    const reason = `${hot.name} is at ${Math.round(pct(hot.memoryUsed, hot.memoryTotal))}% memory, ${cool.name} at ${Math.round(pct(cool.memoryUsed, cool.memoryTotal))}%`;
    const candidates = input.instances
      .filter((i) => i.clusterId === hot.id && i.project === hotP.project && i.status === "Running" && (i.memoryUsed ?? 0) > 0)
      .sort((a, b) => b.memoryUsed! - a.memoryUsed! || a.name.localeCompare(b.name));
    let n = 0;
    for (const i of candidates) {
      if (n >= PER_TENANT || Math.abs(gap()) <= input.threshold) break;
      const before = Math.abs(gap());
      hotUsed -= i.memoryUsed!;
      coolUsed += i.memoryUsed!;
      if (Math.abs(gap()) >= before) {
        hotUsed += i.memoryUsed!;
        coolUsed -= i.memoryUsed!;
        continue;
      }
      n++;
      out.push({
        tenantId,
        tenantSlug: hotP.tenantSlug,
        instanceId: i.id,
        project: i.project,
        name: i.name,
        memoryBytes: i.memoryUsed!,
        fromClusterId: hot.id,
        fromClusterName: hot.name,
        toClusterId: cool.id,
        toClusterName: cool.name,
        toProject: coolP.project,
        reason,
      });
    }
  }
  return out;
}
