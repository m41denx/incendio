/**
 * Pure projection of CAPI objects (`kubectl get clusters|machines -o json`)
 * into the status the UI shows. Kept free of I/O so it can be unit-tested
 * against captured CRD shapes.
 */

import { desiredCounts, type Topology } from "./scale.ts";

export interface CapiCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

export type MachineRole = "control-plane" | "worker";

export interface MachineStatus {
  name: string;
  role: MachineRole;
  phase: string;
  /** CAPI's Ready condition: the node is healthy (kubelet, CNI...). */
  ready: boolean;
  nodeName?: string;
  version?: string;
  address?: string;
  /** Why the machine is not Ready (CAPI's aggregated condition message). */
  message?: string;
}

export interface LiveStatus {
  phase: string;
  available: boolean;
  controlPlaneReady: number;
  workerReady: number;
  /** Desired replicas from spec.topology (authoritative over the cache). */
  controlPlaneDesired?: number;
  workerDesired?: number;
  /** Why the cluster is not Available yet (CAPI's aggregated condition message). */
  message?: string;
  /** Workload cluster API server, from spec.controlPlaneEndpoint. */
  endpoint?: string;
  conditions: CapiCondition[];
  machines: MachineStatus[];
}

interface K8sObject {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: {
    version?: string;
    controlPlaneEndpoint?: { host?: string; port?: number };
    topology?: Topology;
  };
  status?: {
    phase?: string;
    conditions?: CapiCondition[];
    nodeRef?: { name?: string };
    addresses?: { type?: string; address?: string }[];
  };
}

export interface K8sList {
  items?: K8sObject[];
}

const CLUSTER_LABEL = "cluster.x-k8s.io/cluster-name";
const CONTROL_PLANE_LABEL = "cluster.x-k8s.io/control-plane";

const condition = (obj: K8sObject, type: string): CapiCondition | undefined =>
  obj.status?.conditions?.find((c) => c.type === type);

const nonEmpty = (value: string | undefined): string | undefined =>
  value && value.trim().length > 0 ? value.trim() : undefined;

function toMachine(m: K8sObject): MachineStatus {
  const labels = m.metadata?.labels ?? {};
  const ready = condition(m, "Ready");
  const isReady = ready?.status === "True";
  const address =
    m.status?.addresses?.find((a) => a.type === "InternalIP")?.address ??
    m.status?.addresses?.[0]?.address;
  return {
    name: m.metadata?.name ?? "",
    role: CONTROL_PLANE_LABEL in labels ? "control-plane" : "worker",
    phase: m.status?.phase ?? "Unknown",
    ready: isReady,
    nodeName: m.status?.nodeRef?.name,
    version: m.spec?.version,
    address,
    message: isReady ? undefined : nonEmpty(ready?.message),
  };
}

/**
 * Live status for every workload cluster, keyed by name. A machine counts as
 * ready on CAPI's Ready condition — phase "Running" only means its instance is
 * up and joined, which a node without a CNI also reaches.
 */
export function summarizeLive(
  clusters: K8sList,
  machines: K8sList,
): Map<string, LiveStatus> {
  const byCluster = new Map<string, MachineStatus[]>();
  for (const m of machines.items ?? []) {
    const cluster = m.metadata?.labels?.[CLUSTER_LABEL];
    if (!cluster) continue;
    const list = byCluster.get(cluster) ?? [];
    list.push(toMachine(m));
    byCluster.set(cluster, list);
  }

  const out = new Map<string, LiveStatus>();
  for (const c of clusters.items ?? []) {
    const name = c.metadata?.name;
    if (!name) continue;
    const available = condition(c, "Available");
    const isAvailable = available?.status === "True";
    const list = (byCluster.get(name) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const endpoint = c.spec?.controlPlaneEndpoint;
    const desired = desiredCounts(c);
    out.set(name, {
      phase: c.status?.phase ?? "Unknown",
      available: isAvailable,
      controlPlaneReady: list.filter((m) => m.role === "control-plane" && m.ready)
        .length,
      workerReady: list.filter((m) => m.role === "worker" && m.ready).length,
      controlPlaneDesired: desired.controlPlane,
      workerDesired: desired.workers,
      // CAPI v1beta2 aggregates the blocking sub-conditions into this message.
      message: isAvailable ? undefined : nonEmpty(available?.message),
      endpoint: endpoint?.host
        ? `https://${endpoint.host}:${endpoint.port ?? 6443}`
        : undefined,
      conditions: c.status?.conditions ?? [],
      machines: list,
    });
  }
  return out;
}
