import type { ClusterStatus } from "../db/schema.ts";
import type { LiveStatus } from "./capi-status.ts";

// Statuses of a cluster that has not been Available yet.
const BRINGING_UP = new Set<ClusterStatus>(["pending", "provisioning"]);

/**
 * Next cached status from the previous one and the live CRDs. The cache is the
 * memory that tells a first bring-up (a worker still joining is part of
 * "provisioning") from a day-2 rollout on a cluster that was ready before
 * (the same worker joining after a scale-up is "scaling").
 */
export function nextStatus(prev: ClusterStatus, live: LiveStatus): ClusterStatus {
  if (live.phase === "Failed") return "error";
  if (BRINGING_UP.has(prev)) return live.available ? "ready" : "provisioning";
  if (live.rollout) return live.rollout;
  return live.available ? "ready" : "provisioning";
}
