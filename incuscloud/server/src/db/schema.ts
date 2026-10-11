import { sql } from "drizzle-orm";
import { bigserial, boolean, check, customType, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
});

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
  disabled: boolean("disabled").notNull().default(false),
  createdAt: created(),
});

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
