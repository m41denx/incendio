import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
