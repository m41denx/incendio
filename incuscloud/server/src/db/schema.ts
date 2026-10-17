import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Hints } from "../balancing/engine.ts";
import type { Limits, Usage } from "../tenants/quota.ts";
import type { K8sSpec } from "../k8s/model.ts";

const citext = customType<{ data: string }>({ dataType: () => "citext" });
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Incus clusters the control plane manages. */
export const clusters = pgTable("clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  url: text("url").notNull(),
  addresses: jsonb("addresses").$type<string[]>().notNull().default([]),
  /** SHA-256 of the cluster certificate, lowercase hex: the TLS pin. */
  fingerprint: text("fingerprint").notNull(),
  serverCert: text("server_cert").notNull(),
  /** The control plane's admin client certificate on this cluster. */
  clientCert: text("client_cert").notNull(),
  clientKeyEnc: text("client_key_enc").notNull(),
  status: text("status").notNull().default("pending"),
  statusMessage: text("status_message").notNull().default(""),
  labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
  fgaStoreId: text("fga_store_id"),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  /** Last full scan of the cluster store for stray IncusCloud tuples. */
  grantsScannedAt: timestamp("grants_scanned_at", { withTimezone: true }),
  /** Set by changes that affect the cluster; cleared once the reconciler has served every request. */
  reconcileRequestedAt: timestamp("reconcile_requested_at", { withTimezone: true }),
  /** Bumped by every request; the reconciler records the generation it served (clock-free). */
  reconcileGeneration: integer("reconcile_generation").notNull().default(0),
  reconciledGeneration: integer("reconciled_generation").notNull().default(0),
  /** Last inventory pass (P5), successful or not; `inventoryError` is empty when it succeeded. */
  inventoryAt: timestamp("inventory_at", { withTimezone: true }),
  inventoryError: text("inventory_error").notNull().default(""),
});

/** Leader election between workers (one reconciler at a time). */
export const leases = pgTable("leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Grant tuples IncusCloud wrote to a cluster's store (OpenFGA cannot list them cheaply). */
export const clusterGrants = pgTable(
  "cluster_grants",
  {
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    user: text("user").notNull(),
    relation: text("relation").notNull(),
    object: text("object").notNull(),
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.user, t.relation, t.object] })],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: created(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const platformRoles = pgTable(
  "platform_roles",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [check("platform_role_valid", sql`${t.role} in ('admin', 'operator', 'viewer')`)],
);

export type Quotas = Partial<Record<"instances" | "cpu" | "memory" | "disk", number>>;

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  quotas: jsonb("quotas").$type<Quotas>().notNull().default({}),
  createdAt: created(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), check("tenant_role_valid", sql`${t.role} in ('owner', 'admin', 'member', 'viewer')`)],
);

/** Machine identities: Hydra client_credentials clients whose `sub` is clientId. */
export const serviceAccounts = pgTable("service_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().unique(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  /** Platform-wide role for platform-level accounts (no tenant). */
  platformRole: text("platform_role"),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: created(),
});

/**
 * Explicit permission entries (spec: IncusCloud permissions). Today's roles
 * (platform_roles, tenant_members, service accounts) are entries too, read
 * as such by the resolver. A subject is a user or a service account; their
 * deletion removes their entries.
 */
export const aclEntries = pgTable(
  "acl_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    path: text("path").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    serviceAccountId: uuid("service_account_id").references(() => serviceAccounts.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    propagate: boolean("propagate").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [
    check("acl_entry_one_subject", sql`num_nonnulls(${t.userId}, ${t.serviceAccountId}) = 1`),
    unique("acl_entry_unique").on(t.path, t.userId, t.serviceAccountId, t.role).nullsNotDistinct(),
    index("acl_entries_path").on(t.path),
  ],
);

/** A tenant placed on a cluster: the reconciler (P3) creates its Incus project there. */
export const placements = pgTable(
  "placements",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    project: text("project").notNull(),
    status: text("status").notNull().default("pending"),
    statusMessage: text("status_message").notNull().default(""),
    /** What the project uses, as Incus counts it (P9); null until first read. */
    usage: jsonb("usage").$type<Usage>(),
    /** The share of the tenant's quota last applied to the project. */
    limits: jsonb("limits").$type<Limits>(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.clusterId] })],
);

/** Browser sessions (BFF): tokens stay server-side. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: created(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent").notNull().default(""),
  ip: text("ip").notNull().default(""),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull().default(""),
  targetId: text("target_id").notNull().default(""),
  result: text("result").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip").notNull().default(""),
});

/** Requests that went through the gateway (writes always, reads sampled). */
export const gatewayRequests = pgTable(
  "gateway_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    clusterId: uuid("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    method: text("method").notNull(),
    /** Without the query string, at most 512 characters. */
    path: text("path").notNull(),
    status: integer("status").notNull(),
    bytesIn: bigint("bytes_in", { mode: "number" }).notNull(),
    bytesOut: bigint("bytes_out", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    ip: text("ip").notNull().default(""),
  },
  (t) => [index("gateway_requests_cluster_id_idx").on(t.clusterId, t.id), index("gateway_requests_actor_id_idx").on(t.actorId, t.id)],
);

// Fleet inventory (P5): what the worker last read from each cluster. Never written by the API.

const clusterRef = () =>
  uuid("cluster_id")
    .notNull()
    .references(() => clusters.id, { onDelete: "cascade" });
const big = (name: string) => bigint(name, { mode: "number" });

/** Cluster members; a standalone server is one member named after the server. */
export const clusterMembers = pgTable(
  "cluster_members",
  {
    clusterId: clusterRef(),
    name: text("name").notNull(),
    url: text("url").notNull().default(""),
    status: text("status").notNull(),
    roles: jsonb("roles").$type<string[]>().notNull().default([]),
    architecture: text("architecture").notNull().default(""),
    cpuThreads: integer("cpu_threads").notNull().default(0),
    memoryTotal: big("memory_total").notNull().default(0),
    memoryUsed: big("memory_used").notNull().default(0),
    load1: real("load1"),
    uptimeS: big("uptime_s"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.name] })],
);

/** Instances in every project; counters are Incus's, rates are derived between passes. */
export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clusterId: clusterRef(),
    project: text("project").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    location: text("location").notNull().default(""),
    description: text("description").notNull().default(""),
    architecture: text("architecture").notNull().default(""),
    createdAtIncus: timestamp("created_at_incus", { withTimezone: true }),
    imageOs: text("image_os").notNull().default(""),
    imageRelease: text("image_release").notNull().default(""),
    limitsCpu: text("limits_cpu").notNull().default(""),
    limitsMemory: text("limits_memory").notNull().default(""),
    cpuNs: big("cpu_ns"),
    memoryUsed: big("memory_used"),
    memoryTotal: big("memory_total"),
    diskUsed: big("disk_used"),
    netRx: big("net_rx"),
    netTx: big("net_tx"),
    cpuCores: real("cpu_cores"),
    netRxBps: real("net_rx_bps"),
    netTxBps: real("net_tx_bps"),
    addresses: jsonb("addresses").$type<string[]>().notNull().default([]),
    /** Balancing hints from the instance's user.incuscloud.* keys. */
    hints: jsonb("hints").$type<Hints>().notNull().default({}),
    /** Lower-case haystack for the global search. */
    search: text("search").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("instances_cluster_project_name").on(t.clusterId, t.project, t.name), index("instances_cluster_id_idx").on(t.clusterId)],
);

/** Storage pools per member (space is per member for local drivers). */
export const storagePools = pgTable(
  "storage_pools",
  {
    clusterId: clusterRef(),
    member: text("member").notNull(),
    name: text("name").notNull(),
    driver: text("driver").notNull(),
    status: text("status").notNull(),
    spaceTotal: big("space_total"),
    spaceUsed: big("space_used"),
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.member, t.name] })],
);

export const networks = pgTable(
  "networks",
  {
    clusterId: clusterRef(),
    project: text("project").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    managed: boolean("managed").notNull(),
    status: text("status").notNull().default(""),
    description: text("description").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.project, t.name] })],
);

/** Short metrics history (pruned after IC_METRICS_RETENTION): `ref` is an instance id or a member name. */
export const metricsSamples = pgTable(
  "metrics_samples",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    clusterId: clusterRef(),
    kind: text("kind").$type<"instance" | "member">().notNull(),
    ref: text("ref").notNull(),
    cpuCores: real("cpu_cores"),
    memoryUsed: big("memory_used"),
    netRxBps: real("net_rx_bps"),
    netTxBps: real("net_tx_bps"),
    load1: real("load1"),
  },
  (t) => [index("metrics_samples_ref_idx").on(t.kind, t.ref, t.at), index("metrics_samples_at_idx").on(t.at), check("metrics_samples_kind", sql`${t.kind} in ('instance', 'member')`)],
);

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface JobProgress {
  stage: string;
  percent?: number;
  message?: string;
}

/** Work the worker runs (P6+): migrations, replication runs, failovers. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    state: text("state").$type<JobState>().notNull().default("queued"),
    progress: jsonb("progress").$type<JobProgress>().notNull().default({ stage: "queued" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error").notNull().default(""),
    /** The tenant whose members may see the job. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    clusterIds: jsonb("cluster_ids").$type<string[]>().notNull().default([]),
    /** `<clusterId>/<project>/<name>`: one active job per instance. */
    instanceKey: text("instance_key"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    holder: text("holder"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: created(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_active_instance").on(t.instanceKey).where(sql`${t.state} in ('queued', 'running')`),
    index("jobs_state_idx").on(t.state, t.createdAt),
    index("jobs_tenant_idx").on(t.tenantId, t.createdAt),
    check("jobs_state", sql`${t.state} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`),
  ],
);

/** A scheduled replica of an instance on another cluster (P6). */
export const replicationPolicies = pgTable(
  "replication_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    sourceClusterId: uuid("source_cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    sourceProject: text("source_project").notNull(),
    instanceName: text("instance_name").notNull(),
    targetClusterId: uuid("target_cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    targetProject: text("target_project").notNull(),
    targetName: text("target_name").notNull(),
    intervalS: integer("interval_s").notNull().default(3600),
    enabled: boolean("enabled").notNull().default(true),
    state: text("state").$type<"active" | "failed-over">().notNull().default("active"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error").notNull().default(""),
    lastJobId: uuid("last_job_id"),
    createdBy: text("created_by").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("replication_policies_instance_target").on(t.sourceClusterId, t.sourceProject, t.instanceName, t.targetClusterId),
    check("replication_policies_state", sql`${t.state} in ('active', 'failed-over')`),
    check("replication_policies_interval", sql`${t.intervalS} between 60 and 604800`),
  ],
);

/** S3 endpoints backups go to (P7). Platform-managed; the secret key is sealed with IC_SECRET_KEY. */
export const backupTargets = pgTable("backup_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  endpoint: text("endpoint").notNull(),
  region: text("region").notNull().default(""),
  bucket: text("bucket").notNull(),
  prefix: text("prefix").notNull().default(""),
  accessKeyId: text("access_key_id").notNull(),
  secretKeyEnc: text("secret_key_enc").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: created(),
});

/** Scheduled backups of one instance to one target, keeping the newest `keep`. */
export const backupPolicies = pgTable(
  "backup_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    project: text("project").notNull(),
    instanceName: text("instance_name").notNull(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => backupTargets.id, { onDelete: "restrict" }),
    intervalS: integer("interval_s").notNull().default(86400),
    keep: integer("keep").notNull().default(7),
    instanceOnly: boolean("instance_only").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error").notNull().default(""),
    lastJobId: uuid("last_job_id"),
    createdBy: text("created_by").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("backup_policies_instance_target").on(t.clusterId, t.project, t.instanceName, t.targetId),
    check("backup_policies_interval", sql`${t.intervalS} between 3600 and 2592000`),
    check("backup_policies_keep", sql`${t.keep} between 1 and 365`),
  ],
);

/**
 * How one cluster's members are kept balanced (ProxLB's model). Excluded
 * members are neither sources nor targets; instances in excluded projects
 * never move.
 */
export const balancingPolicies = pgTable(
  "balancing_policies",
  {
    clusterId: uuid("cluster_id")
      .primaryKey()
      .references(() => clusters.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    method: text("method").$type<"memory" | "cpu" | "disk">().notNull().default("memory"),
    mode: text("mode").$type<"used" | "assigned">().notNull().default("used"),
    balanciness: integer("balanciness").notNull().default(10),
    intervalS: integer("interval_s").notNull().default(3600),
    maxMoves: integer("max_moves").notNull().default(5),
    allowRestart: boolean("allow_restart").notNull().default(false),
    excludeMembers: jsonb("exclude_members").$type<string[]>().notNull().default([]),
    excludeProjects: jsonb("exclude_projects").$type<string[]>().notNull().default([]),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error").notNull().default(""),
    lastJobId: uuid("last_job_id"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("balancing_policies_method", sql`${t.method} in ('memory', 'cpu', 'disk')`),
    check("balancing_policies_mode", sql`${t.mode} in ('used', 'assigned')`),
    check("balancing_policies_balanciness", sql`${t.balanciness} between 1 and 100`),
    check("balancing_policies_interval", sql`${t.intervalS} between 300 and 86400`),
    check("balancing_policies_max_moves", sql`${t.maxMoves} between 1 and 50`),
  ],
);

export type BackupState = "creating" | "ready" | "failed";

/** One backup object in a target. The source columns describe what was backed up; the cluster may be gone since. */
export const backups = pgTable(
  "backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    policyId: uuid("policy_id").references(() => backupPolicies.id, { onDelete: "set null" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => backupTargets.id, { onDelete: "restrict" }),
    objectKey: text("object_key").notNull(),
    clusterId: uuid("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
    project: text("project").notNull(),
    instanceName: text("instance_name").notNull(),
    instanceType: text("instance_type").notNull().default(""),
    instanceOnly: boolean("instance_only").notNull().default(false),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    state: text("state").$type<BackupState>().notNull().default("creating"),
    error: text("error").notNull().default(""),
    jobId: uuid("job_id"),
    transport: text("transport").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: created(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [check("backups_state", sql`${t.state} in ('creating', 'ready', 'failed')`), index("backups_policy").on(t.policyId, t.createdAt), index("backups_tenant").on(t.tenantId, t.createdAt)],
);

export type K8sStatus = "creating" | "provisioning" | "ready" | "degraded" | "deleting" | "error";

/** Tenant Kubernetes clusters (P10), run by CAPI + CAPN in the management cluster on one Incus cluster each. */
export const k8sClusters = pgTable(
  "k8s_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Restrict: a tenant or Incus cluster with Kubernetes clusters is not removed under them.
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** The management cluster's namespace: `ic-<tenant slug>`. */
    namespace: text("namespace").notNull(),
    version: text("version").notNull(),
    controlPlanes: integer("control_planes").notNull(),
    workers: integer("workers").notNull(),
    /** The size it was made with, before specs ("" never; null for clusters made from a spec). */
    size: text("size").$type<"small" | "medium" | "large">(),
    /** Machines, load balancer, networking and MetalLB (Incendio's create options). */
    spec: jsonb("spec").$type<K8sSpec>().notNull(),
    /** The workload API endpoint: a member's address and a forwarded port. */
    endpointHost: text("endpoint_host").notNull(),
    endpointPort: integer("endpoint_port").notNull(),
    /** The member the load balancer is pinned to ("" on a single-member cluster). */
    lbMember: text("lb_member").notNull().default(""),
    status: text("status").$type<K8sStatus>().notNull().default("creating"),
    statusMessage: text("status_message").notNull().default(""),
    nodes: integer("nodes").notNull().default(0),
    nodesReady: integer("nodes_ready").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: created(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (t) => [
    unique("k8s_clusters_tenant_name").on(t.tenantId, t.name),
    unique("k8s_clusters_endpoint").on(t.clusterId, t.endpointHost, t.endpointPort),
    check("k8s_clusters_status", sql`${t.status} in ('creating', 'provisioning', 'ready', 'degraded', 'deleting', 'error')`),
    check("k8s_clusters_size", sql`${t.size} in ('small', 'medium', 'large')`),
  ],
);

/** A project-restricted Incus certificate CAPN uses for one tenant on one cluster; its key lives only in the management cluster. */
export const k8sCredentials = pgTable(
  "k8s_credentials",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.clusterId] })],
);
