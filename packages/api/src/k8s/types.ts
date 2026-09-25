// Wire types of the Incendio Kubernetes agent API (packages/k8s, /v1).

/** Where a record's live fields came from: the CAPI CRDs, or the agent's cache. */
export type ClusterSource = "cache" | "crd";

export type ClusterStatus =
  | "pending"
  | "provisioning"
  | "ready"
  | "scaling"
  | "upgrading"
  | "error"
  | (string & {});

/** A day-2 change CAPI is rolling out. */
export type Rollout = "upgrading" | "scaling";

/** `GET /v1/info` — unauthenticated handshake. */
export interface AgentInfo {
  name: string;
  version: string;
  apiVersion: string;
  capabilities: {
    /** The CAPN controller is running: clusters can be created. */
    capn: boolean;
    operator?: boolean;
    projects?: boolean;
    flavors: string[];
    roles?: string[];
    upgrade?: boolean;
    activity?: boolean;
  };
  incus: { apiUrl: string; configured: boolean };
  /** SHA-256 of the agent's self-signed serving certificate (`sha256:<hex>`). */
  tls?: { fingerprint: string | null };
}

/** A managed cluster as listed/returned by the agent. */
export interface ClusterRecord {
  id: string;
  name: string;
  /** Incus project holding the cluster's instances. */
  project: string | null;
  kubernetesVersion: string;
  controlPlaneCount: number;
  workerCount: number;
  status: ClusterStatus;
  /** The create request, as stored by the agent. */
  spec?: unknown;
  source?: ClusterSource;
  /** CAPI Cluster phase (`Provisioning`, `Provisioned`, …). */
  phase?: string;
  /** Why the cluster is not Available yet. */
  message?: string;
  /** Workload API server, `https://host:port`. */
  endpoint?: string;
  rollout?: Rollout;
  controlPlaneReady?: number;
  workerReady?: number;
  createdAt: string;
  updatedAt: string;
}

export type MachineRole = "control-plane" | "worker";

/** A CAPI Machine. */
export interface Machine {
  name: string;
  role: MachineRole;
  phase: string;
  /** CAPI's Ready condition: kubelet, CNI… healthy. */
  ready: boolean;
  /** Set once the machine joined as a Kubernetes node. */
  nodeName?: string;
  version?: string;
  address?: string;
  message?: string;
}

/** `GET /v1/clusters/:name/status` */
export interface ClusterStatusView {
  name: string;
  status: ClusterStatus;
  ready: boolean;
  source: ClusterSource;
  controlPlane: { desired: number; ready: number | null };
  workers: { desired: number; ready: number | null };
  phase?: string;
  /** Target Kubernetes version. */
  version?: string;
  rollout?: Rollout;
  message?: string;
  endpoint?: string;
  machines?: Machine[];
  conditions: unknown[];
  updatedAt: string;
}

export type ActivityLevel = "info" | "warning" | "error";

/** One line of `GET /v1/clusters/:name/activity`. */
export interface ActivityEntry {
  time: string;
  /** Latest repeat, when `count > 1`. */
  lastTime?: string;
  level: ActivityLevel;
  /** Controller (or `event`) that reported it. */
  source: string;
  /** `Kind/name` of the object it is about. */
  object?: string;
  message: string;
  /** Occurrences folded into this entry. */
  count: number;
}

/** `POST /v1/clusters` body. */
export interface CreateClusterRequest {
  name: string;
  kubernetesVersion?: string;
  controlPlaneCount?: number;
  workerCount?: number;
  /** Incus project (default: generated from the name). */
  project?: string;
  /** CAPN template variables (see `buildTemplateVariables`). */
  variables?: Record<string, string>;
}

/** `PATCH /v1/clusters/:name` body. */
export interface ClusterPatchRequest {
  /** Odd: 1, 3, 5… */
  controlPlaneCount?: number;
  workerCount?: number;
  /** Next minor (or patch) version, `vX.Y.Z`. */
  kubernetesVersion?: string;
}

/** The agent handle stored in Incus server config (`user.k8s.api-config`). */
export interface AgentHandle {
  url: string;
  token: string;
  /** Pinned agent certificate, `sha256:<hex>`. */
  fingerprint?: string | null;
}
