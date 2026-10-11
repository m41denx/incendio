export type PlatformRole = "admin" | "operator" | "viewer";
export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type Quotas = Partial<Record<"instances" | "cpu" | "memory" | "disk", number>>;

export interface Me {
  id: string;
  kind: "user" | "service";
  email?: string;
  name: string;
  platformRole: PlatformRole | null;
  tenants: Array<{ id: string; slug: string; name: string; role: TenantRole }>;
  clusterDomain: string;
  publicUrl: string;
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
