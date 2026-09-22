import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { env } from "../env.ts";
import { log } from "../lib/log.ts";
import * as schema from "./schema.ts";

/**
 * bun:sqlite + drizzle store. Cache/log only — the CAPI/CAPN CRDs stay
 * authoritative (docs/k8s/management-appliance.md §6).
 *
 * The agent ships as a single Bun binary that is dropped into a freshly
 * bootstrapped container, so we DDL the tables at boot with
 * `CREATE TABLE IF NOT EXISTS` (idempotent) rather than depending on a
 * drizzle-kit migration step being run in the appliance. drizzle-kit is still
 * wired (drizzle.config.ts) for local schema evolution / studio.
 */

function openDatabase(): Database {
  if (env.DB_PATH !== ":memory:") {
    const dir = dirname(env.DB_PATH);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(env.DB_PATH, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return sqlite;
}

const sqlite = openDatabase();

/**
 * Create the tables if they do not exist. Kept in sync with schema.ts by hand;
 * the column definitions must match. Safe to call repeatedly.
 */
function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      project TEXT,
      k8s_version TEXT NOT NULL,
      cp_count INTEGER NOT NULL DEFAULT 1,
      worker_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      spec_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      cluster_id TEXT,
      kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      log TEXT,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_cluster_id ON tasks (cluster_id);

    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      action TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts);
  `);
}

ensureSchema();
log.info(`sqlite store ready at ${env.DB_PATH}`);

export const db = drizzle(sqlite, { schema });
export { schema };
