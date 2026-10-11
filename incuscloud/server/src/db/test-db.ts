import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrationsFolder, schema, type Db } from "./index.ts";

/** A fresh in-memory Postgres with every migration applied. */
export async function testDb(): Promise<Db> {
  const client = new PGlite({ extensions: { citext } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}
