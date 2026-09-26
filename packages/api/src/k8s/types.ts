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
    /** MetalLB for LoadBalancer services (agent 0.3.0+). */
    metallb?: boolean;
    /** Controller health and restart (agent 0.3.1+). */
    controllers?: boolean;
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
  /** Workload API server, `https://host:port` (`https://[v6]:port`). */
  endpoint?: string;
  /** Why the cluster cannot come up on its own, when the agent can tell. */
  problem?: string;
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
  /** Why the cluster cannot come up on its own, when the agent can tell. */
  problem?: string;
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
  /** Install MetalLB with these addresses once the cluster is first ready. */
  metallb?: { addresses: string[] };
}

/** `PATCH /v1/clusters/:name` body. */
export interface ClusterPatchRequest {
  /** Odd: 1, 3, 5… */
  controlPlaneCount?: number;
  workerCount?: number;
  /** Next minor (or patch) version, `vX.Y.Z`. */
  kubernetesVersion?: string;
}

export type MetalLBState =
  | "absent"
  /** Requested at create time; the control plane is not up yet. */
  | "waiting"
  | "installing"
  | "installed"
  | "removing"
  | "failed";

/** A `type: LoadBalancer` service of a workload cluster. */
export interface LoadBalancerService {
  namespace: string;
  name: string;
  /** External addresses; empty while pending. */
  addresses: string[];
  /** e.g. `80/TCP`. */
  ports: string[];
}

/** `GET /v1/clusters/:name/metallb` */
export interface MetalLBStatus {
  state: MetalLBState;
  /** Why the last install/remove failed (state `failed`). */
  error?: string;
  /** MetalLB version, when installed. */
  version?: string;
  /** The agent's address pool, when installed. */
  addresses: string[];
  services: LoadBalancerService[];
  /** Addresses asked for (at create or by the last change), if any. */
  requested?: string[] | null;
}

/** `GET /v1/clusters/metallb-hint` — the cluster network and a free address block. */
export interface MetalLBHint {
  /** Incus network the nodes use. */
  network: string;
  /** Its `ipv4.address` (gateway/prefix). */
  cidr: string;
  subnet: string;
  /** Proposed range (`a.b.c.d-e.f.g.h`), or null when nothing is free. */
  range: string | null;
  /** Why the range may still collide (e.g. no DHCP range on the network). */
  warning?: string;
}

/** A node Cluster API cannot inspect (`GET /v1/management/controllers`). */
export interface UnreachableMachine {
  cluster: string;
  machine: string;
  /** The Machine condition that says so. */
  condition: string;
  message: string;
  /** When the condition turned Unknown. */
  since: string;
}

/** A restart of the Cluster API controllers. */
export interface ControllerRestart {
  at: string;
  reason: string;
  /** Done by the agent's watchdog rather than requested. */
  automatic: boolean;
  /** Absent while the restart is still rolling out. */
  ok?: boolean;
  error?: string;
}

/** `GET /v1/management/controllers` */
export interface ControllerHealth {
  deployments: {
    namespace: string;
    name: string;
    ready: number;
    desired: number;
  }[];
  unreachable: UnreachableMachine[];
  restarting: boolean;
  lastRestart?: ControllerRestart;
  /** The agent restarts stuck controllers itself. */
  watchdog: boolean;
}

/** The agent handle stored in Incus server config (`user.k8s.api-config`). */
export interface AgentHandle {
  url: string;
  token: string;
  /** Pinned agent certificate, `sha256:<hex>`. */
  fingerprint?: string | null;
}
