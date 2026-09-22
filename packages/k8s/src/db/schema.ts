import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the agent's local store. This is a CACHE/LOG only: the
 * CAPI/CAPN CRDs in the mgmt k3s cluster stay authoritative for real cluster
 * state (see docs/k8s/management-appliance.md §6). We mirror status into these
 * tables on demand for fast SWR reads and to keep an audit trail; we never treat
 * sqlite as a second source of truth.
 */

// Cluster provisioning lifecycle as reflected in the local cache. Real state is
// derived from CRD conditions once CAPN is wired; until then it tracks the
// project-stamp step the agent performs.
export const CLUSTER_STATUSES = [
  "pending",
  "provisioning",
  "ready",
  "error",
] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];

export const clusters = sqliteTable("clusters", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  project: text("project"),
  k8sVersion: text("k8s_version").notNull(),
  cpCount: integer("cp_count").notNull().default(1),
  workerCount: integer("worker_count").notNull().default(0),
  status: text("status").notNull().default("pending"),
  // Full validated create-spec as JSON (kubeadm version, flavor, CIDRs, node
  // groups, ...). Lets the schema stay stable as the UI spec evolves.
  specJson: text("spec_json"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Provisioning task state/log surfaced to the UI via GET /v1/tasks/:id (SWR).
export const TASK_STATES = ["pending", "running", "done", "error"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  clusterId: text("cluster_id"),
  kind: text("kind").notNull(),
  state: text("state").notNull().default("pending"),
  message: text("message"),
  log: text("log"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

// Append-only audit trail of every mutating action the agent performs.
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  ts: text("ts")
    .notNull()
    .default(sql`(datetime('now'))`),
  actor: text("actor"),
  action: text("action").notNull(),
  detail: text("detail"),
});

export type ClusterRow = typeof clusters.$inferSelect;
export type NewClusterRow = typeof clusters.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type AuditRow = typeof audit.$inferSelect;
