import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { openDb } from "./index.ts";
import { users } from "./schema.ts";

// Live: IC_IT_POSTGRES=postgres://postgres@host/db (an empty database).
const url = process.env.IC_IT_POSTGRES;

test.if(!!url)("migrations and queries work on real Postgres, and re-opening is idempotent", async () => {
  const db = await openDb(url!);
  const email = `pg-${crypto.randomUUID()}@Example.com`;
  await db.insert(users).values({ email, name: "Pg" });
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  expect(u?.name).toBe("Pg");
  const again = await openDb(url!);
  const [{ n }] = (await again.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as [{ n: number }];
  const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  expect(n).toBe(journal.entries.length);
  await again.delete(users).where(eq(users.id, u!.id));
});
