export type PlatformRole = "admin" | "operator" | "viewer";
export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type Quotas = Partial<
  Record<"instances" | "cpu" | "memory" | "disk" | "maxInstanceCpu" | "maxInstanceMemory" | "maxInstanceDisk" | "snapshots" | "backups" | "backupGiB" | "kubernetes", number>
>;
export type UserQuotas = Partial<Record<"instances" | "cpu" | "memory" | "backups", number>>;
export interface UserQuotaRow {
  userId: string;
  email: string;
  quotas: UserQuotas;
  /** Memory in bytes; the rest are counts. */
  used: Required<UserQuotas>;
}

export interface Me {
  id: string;
  kind: "user" | "service";
  email?: string;
  name: string;
  platformRole: PlatformRole | null;
  /** Privileges on `/` (permissions); absent from older servers. */
  rootPrivileges?: string[];
  tenants: Array<{ id: string; slug: string; name: string; role: TenantRole }>;
  clusterDomain: string;
  publicUrl: string;
}

/** A permissions entry: explicit, or one of today's roles read as an entry (edited on its own page). */
export interface AclEntry {
  id: string;
  path: string;
  subject: { type: "user" | "service"; id: string; name: string };
  role: string;
  propagate: boolean;
  source: "acl" | "platform-role" | "tenant-membership" | "service-account";
  editable: boolean;
  editedOn?: "users" | "tenants" | "service-accounts";
}

export interface AclRole {
  id: string;
  name: string;
  privileges: string[];
  ownedOnly?: string[];
}

export interface Cluster {
  id: string;
  name: string;
  url: string;
  addresses: string[];
  fingerprint: string;
  status: "pending" | "ready" | "degraded" | "error" | "disabled" | string;
  statusMessage: string;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  reconciledAt: string | null;
  reconcileRequestedAt: string | null;
}

export interface Placement {
  tenantId: string;
  slug: string;
  project: string;
  status: string;
  statusMessage: string;
  createdAt: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  quotas: Quotas;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: TenantRole;
}

export interface User {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
  platformRole: PlatformRole | null;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** The identity providers they sign in with (on a single user only). */
  identities?: Array<{ provider: string; subject: string; groups: string[]; lastLoginAt: string | null }>;
}

export interface ServiceAccount {
  id: string;
  name: string;
  clientId: string;
  tenantId: string | null;
  platformRole: PlatformRole | null;
  disabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

/** Returned once, by create and rotate. */
export interface ServiceAccountSecret extends ServiceAccount {
  clientSecret: string;
  tokenUrl: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  result: string;
  detail: Record<string, unknown>;
  ip: string;
}

export interface GatewayRequest {
  id: number;
  at: string;
  clusterId: string | null;
  actorType: string;
  actorId: string;
  method: string;
  path: string;
  status: number;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
  ip: string;
}

/** Where a tenant runs: GET /api/v1/tenants/:id/placements. */
export interface TenantPlacement {
  clusterId: string;
  clusterName: string;
  project: string;
  status: string;
  statusMessage: string;
  createdAt: string;
}

/** An instance in the fleet inventory: GET /api/v1/instances[/:id]. */
export interface Instance {
  id: string;
  clusterId: string;
  clusterName: string;
  project: string;
  name: string;
  /** The tenant whose project this is, if any. */
  tenantId: string | null;
  tenantSlug: string | null;
  type: string;
  status: string;
  location: string;
  description: string;
  architecture: string;
  createdAt: string | null;
  imageOs: string;
  imageRelease: string;
  limitsCpu: string;
  limitsMemory: string;
  /** CPU in use, in cores, over the last inventory interval. */
  cpuCores: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  diskUsed: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
  addresses: string[];
  seenAt: string;
  /** When the cluster's inventory was last read. */
  inventoryAt: string | null;
  /** Who owns it (permissions); only on the detail. */
  owner?: { type: "user" | "service"; id: string; name: string } | null;
  /** What the caller may do with it (privileges on its path); only on the detail. */
  privileges?: string[];
}

export interface InstanceList {
  items: Instance[];
  total: number;
}

/** GET /api/v1/instances/:id/metrics */
export interface MetricSample {
  at: string;
  cpuCores: number | null;
  memoryUsed: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
}

export interface ClusterMember {
  name: string;
  url: string;
  status: string;
  roles: string[];
  architecture: string;
  cpuThreads: number;
  memoryTotal: number;
  memoryUsed: number;
  load1: number | null;
  uptimeS: number | null;
}

export interface StoragePool {
  member: string;
  name: string;
  driver: string;
  status: string;
  spaceTotal: number | null;
  spaceUsed: number | null;
}

/** GET /api/v1/clusters/:id/inventory (platform viewers). */
export interface ClusterInventory {
  inventoryAt: string | null;
  inventoryError: string;
  members: ClusterMember[];
  pools: StoragePool[];
  networks: Array<{ project: string; name: string; type: string; managed: boolean; status: string; description: string }>;
  instances: { total: number; running: number };
}

export interface ClusterCapacity {
  id: string;
  name: string;
  status: string;
  inventoryAt: string | null;
  inventoryError: string;
  instances: number;
  running: number;
  cpuThreads: number;
  memoryTotal: number;
  memoryUsed: number;
  storageTotal: number;
  storageUsed: number;
}

/** GET /api/v1/fleet/summary; `clusters` only for platform viewers. */
export interface FleetSummary {
  instances: { total: number; byStatus: Record<string, number> };
  clusters?: ClusterCapacity[];
}

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Work the platform runs: GET /api/v1/jobs[/:id]. */
export interface Job {
  id: string;
  /** migrate, replicate or failover. */
  type: string;
  state: JobState;
  progress: { stage: string; percent?: number; message?: string };
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string;
  tenantId: string | null;
  clusterIds: string[];
  instanceKey: string | null;
  actorType: string;
  actorId: string;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** POST /api/v1/instances/:id/migrations/preflight */
export interface MigrationCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
  targetProject: string;
  targetName: string;
}

/** A scheduled replica of an instance on another cluster: /api/v1/replication-policies. */
export interface ReplicationPolicy {
  id: string;
  tenantId: string | null;
  sourceClusterId: string;
  sourceProject: string;
  instanceName: string;
  targetClusterId: string;
  targetProject: string;
  targetName: string;
  intervalS: number;
  enabled: boolean;
  state: "active" | "failed-over";
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string;
  lastJobId: string | null;
  createdBy: string;
  createdAt: string;
}

/** An S3 target for backups: GET /api/v1/backup-targets. Platform viewers get every field; others only id and name. */
export interface BackupTarget {
  id: string;
  name: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  enabled?: boolean;
  createdAt?: string;
}

export type BackupState = "creating" | "ready" | "failed";

/** GET /api/v1/backups[/:id] */
export interface Backup {
  id: string;
  tenantId: string | null;
  /** Set when a schedule made it; manual backups have none. */
  policyId: string | null;
  targetId: string;
  objectKey: string;
  clusterId: string | null;
  project: string;
  instanceName: string;
  instanceType: string;
  instanceOnly: boolean;
  sizeBytes: number | null;
  state: BackupState;
  error: string;
  jobId: string | null;
  transport: string;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  /** In lists only. */
  targetName?: string;
  clusterName?: string | null;
}

/** Scheduled backups of one instance: /api/v1/backup-policies. */
export interface BackupPolicy {
  id: string;
  tenantId: string | null;
  clusterId: string;
  project: string;
  instanceName: string;
  targetId: string;
  intervalS: number;
  keep: number;
  instanceOnly: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string;
  lastJobId: string | null;
  createdBy: string;
  createdAt: string;
}

export type BalancingMethod = "memory" | "cpu" | "disk";
export type BalancingMode = "used" | "assigned";

/** GET/PUT /api/v1/clusters/:id/balancing (defaults until an operator saves one). */
export interface BalancingPolicy {
  clusterId: string;
  enabled: boolean;
  method: BalancingMethod;
  mode: BalancingMode;
  /** Percentage points of spread (busiest member minus least busy) tolerated. */
  balanciness: number;
  intervalS: number;
  maxMoves: number;
  /** Running instances that cannot move live may be stopped, moved and started. */
  allowRestart: boolean;
  /** Members never balanced from or to. */
  excludeMembers: string[];
  /** Projects whose instances never move. */
  excludeProjects: string[];
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string;
  lastJobId: string | null;
}

/** The fields PUT takes; POST …/balancing/plan takes any of them (unsaved settings to preview). */
export type BalancingSettings = Pick<BalancingPolicy, "enabled" | "intervalS" | "method" | "mode" | "balanciness" | "maxMoves" | "allowRestart" | "excludeMembers" | "excludeProjects">;

export type BalanceReason = "pin" | "anti-affinity" | "affinity" | "balance";

export interface BalanceMove {
  project: string;
  name: string;
  from: string;
  to: string;
  reason: BalanceReason;
}

/** POST /api/v1/clusters/:id/balancing/plan: a dry run. */
export interface BalancingPlan {
  /** Spread before and after, in percentage points. */
  before: number;
  after: number;
  moves: BalanceMove[];
  notes: string[];
}

/** A rebalance job's result. */
export interface RebalanceResult extends BalancingPlan {
  moves: Array<BalanceMove & { outcome: "moved" | "skipped" | "failed"; detail?: string }>;
}

/** POST /api/v1/clusters/:id/members/:name/evacuate { mode } */
export type EvacuateMode = "auto" | "migrate" | "live-migrate" | "stop";

/** GET /api/v1/balancing/suggestions */
export interface BalancingSuggestion {
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
  toProject: string;
  reason: string;
}

/** What a project uses or may use, in Incus's units: counts, CPUs, bytes. */
export interface ResourceUsage {
  instances: number;
  cpu: number;
  memory: number;
  disk: number;
}

/** GET /api/v1/tenants/:id/usage. `quota` is as set (memory and disk in GiB); usage and limits in bytes. */
export interface TenantUsage {
  quota: Quotas;
  used: ResourceUsage;
  clusters: Array<{
    clusterId: string;
    clusterName: string;
    project: string;
    status: string;
    /** Null until the reconciler has read it. */
    usage: ResourceUsage | null;
    /** This project's share of the quota: its usage plus what the tenant has left. Null before the first pass. */
    limits: Partial<ResourceUsage> | null;
  }>;
}

/** GET /api/v1/images: aliases on the image server; `vm` when a VM image exists too. */
export interface ImageChoice {
  alias: string;
  label: string;
  vm: boolean;
}

/** POST /api/v1/tenants/:id/instances → a "create" Job (202). */
export interface CreateInstanceRequest {
  name: string;
  image: string;
  type?: "container" | "virtual-machine";
  cpu: number;
  memoryGiB: number;
  diskGiB: number;
  /** A cluster of the tenant; otherwise IncusCloud picks one. */
  clusterId?: string;
  /** Only clusters with these labels (e.g. { region: "eu" }). */
  labels?: Record<string, string>;
  start?: boolean;
}

export type K8sStatus = "creating" | "provisioning" | "ready" | "degraded" | "deleting" | "error";
export type K8sSize = "small" | "medium" | "large";

/** A Kubernetes cluster run by CAPI on an Incus cluster (P10): GET /api/v1/kubernetes[/:id]. */
export interface K8sCluster {
  id: string;
  tenantId: string;
  tenantSlug: string;
  clusterId: string;
  clusterName: string;
  /** The tenant's Incus project on that cluster, where its nodes run. */
  project: string;
  /** The member its load balancer and nodes run on ("" on a single-member Incus cluster). */
  member?: string;
  name: string;
  version: string;
  controlPlanes: number;
  workers: number;
  /** The size it was made with; null when made from a spec. */
  size: K8sSize | null;
  /** Its machines, load balancer, networking and MetalLB (Incendio's create options). */
  spec: K8sSpec;
  /** https://host:port: a forward to its load balancer, or a kube-vip / OVN address. */
  endpoint: string;
  status: K8sStatus;
  statusMessage: string;
  nodes: number;
  nodesReady: number;
  createdBy: string;
  createdAt: string;
  syncedAt: string | null;
}

/** GET /api/v1/kubernetes/:id/nodes: a Cluster API Machine and the Incus instance it runs on. */
export interface K8sNode {
  name: string;
  role: "control-plane" | "worker";
  instance: string;
  phase: string;
  version: string;
  ready: boolean;
}

/** GET /api/v1/kubernetes/versions. */
export interface K8sOptions {
  /** False when IncusCloud has no management cluster: every other Kubernetes call answers 409. */
  enabled: boolean;
  versions: string[];
  sizes: Record<K8sSize, { cpu: number; memoryGiB: number }>;
  /** What the create form starts from. */
  defaults?: K8sSpec;
}

/** One role's instances: `flavor` is CAPN's `c<cores>-m<GiB>`; `target` a member, `@group` or "" (anywhere). */
export interface K8sMachineSpec {
  type: "container" | "virtual-machine";
  flavor: string;
  profiles: string[];
  target: string;
}
export type K8sLbSpec =
  | { type: "lxc" | "oci"; flavor: string; profiles: string[]; target: string }
  | { type: "kube-vip"; host: string; interface: string }
  | { type: "ovn"; host: string; networkName: string };
export interface K8sSpec {
  controlPlane: K8sMachineSpec;
  worker: K8sMachineSpec;
  loadBalancer: K8sLbSpec;
  image: string;
  privileged: boolean;
  flannel: boolean;
  installKubeadm: boolean;
  podCidr: string;
  serviceCidr: string;
  metallb: { addresses: string[] } | null;
}

/** GET /api/v1/kubernetes/:id/status. */
export interface K8sClusterStatus {
  phase: string;
  /** Why it is not available yet ("" when it is). */
  message: string;
  endpoint: string;
  conditions: Array<{ type: string; status: string; reason: string; message: string; lastTransitionTime: string }>;
}

/** GET /api/v1/kubernetes/:id/activity: Incendio's activity entries. */
export interface K8sActivityEntry {
  time: string;
  lastTime?: string;
  level: "info" | "warning" | "error";
  source: string;
  object?: string;
  message: string;
  count: number;
}

/** GET /api/v1/kubernetes/:id/metallb. */
export interface K8sMetalLB {
  /** The addresses asked for (null: no MetalLB asked for). */
  requested: string[] | null;
  installed: boolean;
  ready: boolean;
  addresses: string[];
  message: string;
}

/** POST /api/v1/kubernetes. */
export interface CreateK8sRequest {
  tenantId: string;
  clusterId: string;
  name: string;
  version: string;
  controlPlanes: 1 | 3 | 5;
  workers: number;
  size?: K8sSize;
  spec?: K8sSpec;
  /** On a multi-member Incus cluster: the member its load balancer and nodes run on (default: chosen). */
  member?: string;
}
