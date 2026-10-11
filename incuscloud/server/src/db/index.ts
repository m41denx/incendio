import { drizzle as bunSql } from "drizzle-orm/bun-sql";
import { migrate as migrateBunSql } from "drizzle-orm/bun-sql/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

/** Any Drizzle Postgres database with our schema (bun-sql in production, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

/** Opens the production database and applies pending migrations. */
export async function openDb(url: string): Promise<Db> {
  const db = bunSql(url, { schema });
  await migrateBunSql(db, { migrationsFolder });
  return db as unknown as Db;
}

export { schema };
