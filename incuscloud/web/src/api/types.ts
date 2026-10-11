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
