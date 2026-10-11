import { drizzle as bunSql } from "drizzle-orm/bun-sql";
import { migrate as migrateBunSql } from "drizzle-orm/bun-sql/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

/** Any Drizzle Postgres database with our schema (bun-sql in production, PGlite in development and tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Opens the database and applies pending migrations.
 * `postgres://…` is production; `pglite:memory` or `pglite:/path` is an
 * embedded single-process database for development.
 */
export async function openDb(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { citext } = await import("@electric-sql/pglite/contrib/citext");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const path = url.slice("pglite:".length);
    const client = new PGlite({ dataDir: path === "memory" ? undefined : path, extensions: { citext } });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const db = bunSql(url, { schema });
  await migrateBunSql(db, { migrationsFolder });
  return db as unknown as Db;
}

export { schema };
