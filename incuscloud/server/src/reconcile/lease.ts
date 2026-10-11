import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { leases } from "../db/schema.ts";

/** Takes or renews the lease; true when `holder` holds it for the next `ttlMs`. Expiry uses the database clock. */
export async function acquireLease(db: Db, name: string, holder: string, ttlMs: number): Promise<boolean> {
  const expiresAt = sql`now() + ${`${Math.max(1, Math.round(ttlMs))} milliseconds`}::interval`;
  const rows = await db
    .insert(leases)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({
      target: leases.name,
      set: { holder, expiresAt },
      setWhere: sql`${leases.holder} = ${holder} or ${leases.expiresAt} < now()`,
    })
    .returning({ holder: leases.holder });
  return rows.length === 1;
}

export async function releaseLease(db: Db, name: string, holder: string): Promise<void> {
  await db.delete(leases).where(and(eq(leases.name, name), eq(leases.holder, holder)));
}
