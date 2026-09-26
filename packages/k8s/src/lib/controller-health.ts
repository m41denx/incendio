/**
 * Spotting Cluster API controllers that lost their workload-cluster
 * connections. After the appliance is paused or the host sleeps, the
 * controllers' cached clients can stay broken: KubeadmControlPlane keeps
 * reporting the control-plane node "unreachable" (condition reason
 * InspectionFailed) although the node is Ready and its API server answers, and
 * the cluster sits in "provisioning" for good. Restarting the controllers
 * clears it. Pure here; the watchdog is self-heal.ts.
 */

export interface MachineCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface MachineObject {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    deletionTimestamp?: string;
  };
  status?: { phase?: string; conditions?: MachineCondition[] };
}

export interface StaleMachine {
  cluster: string;
  machine: string;
  /** The condition that says so, e.g. APIServerPodHealthy. */
  condition: string;
  message: string;
  /** When the condition turned Unknown. */
  since: string;
}

const CLUSTER_LABEL = "cluster.x-k8s.io/cluster-name";

/**
 * Machines whose node Cluster API has been unable to inspect ("unreachable")
 * for at least `minAgeMs`. Machines on their way out are skipped: their nodes
 * are expected to disappear.
 */
export function staleInspections(
  machines: { items?: MachineObject[] },
  now: Date,
  minAgeMs: number,
): StaleMachine[] {
  const out: StaleMachine[] = [];
  for (const m of machines.items ?? []) {
    if (m.metadata?.deletionTimestamp || m.status?.phase === "Deleting") continue;
    const cluster = m.metadata?.labels?.[CLUSTER_LABEL];
    const name = m.metadata?.name;
    if (!cluster || !name) continue;
    const hits = (m.status?.conditions ?? [])
      .filter(
        (c) =>
          c.status === "Unknown" &&
          c.reason === "InspectionFailed" &&
          /unreachable/i.test(c.message ?? "") &&
          c.lastTransitionTime !== undefined &&
          now.getTime() - Date.parse(c.lastTransitionTime) >= minAgeMs,
      )
      .sort((a, b) => Date.parse(a.lastTransitionTime!) - Date.parse(b.lastTransitionTime!));
    const first = hits[0];
    if (!first) continue;
    out.push({
      cluster,
      machine: name,
      condition: first.type ?? "",
      message: first.message ?? "",
      since: first.lastTransitionTime!,
    });
  }
  return out;
}
