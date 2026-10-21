import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableName, isTable, sql } from "drizzle-orm";
import { migrationsFolder, schema, type Db } from "./index.ts";

// One migrated in-memory Postgres per test process, emptied on each call:
// a PGlite instance is a WASM Postgres (~100 MB) and they are slow to free.
let shared: Promise<Db> | undefined;
const tables = Object.values(schema)
  .filter(isTable)
  .map((t) => `"${getTableName(t)}"`)
  .join(", ");

/**
 * An empty, migrated test database. Every call empties and returns the same
 * database, so a test must not hold two at once.
 */
export async function testDb(): Promise<Db> {
  shared ??= (async () => {
    const client = new PGlite({ extensions: { citext } });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  })();
  const db = await shared;
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  return db;
}
