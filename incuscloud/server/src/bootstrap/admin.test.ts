import { expect, test } from "bun:test";
import { platformRoles, users } from "../db/schema.ts";
import { testDb } from "../db/test-db.ts";
import { FakeAuthz } from "../authz/fake.ts";
import { verifyPassword } from "../identity/passwords.ts";
import { ensureBootstrapAdmin } from "./admin.ts";

const cfg = { email: "boot@example.com", password: "boot-password-123" };

test("creates the first admin once", async () => {
  const db = await testDb();
  const authz = new FakeAuthz();
  await ensureBootstrapAdmin(db, authz, cfg);
  await ensureBootstrapAdmin(db, authz, cfg);
  const all = await db.select().from(users);
  expect(all.length).toBe(1);
  expect(await verifyPassword(cfg.password, all[0]!.passwordHash!)).toBe(true);
  expect(await db.select().from(platformRoles)).toEqual([{ userId: all[0]!.id, role: "admin" }]);
  expect(await authz.check(`user:${all[0]!.id}`, "admin", "platform:main")).toBe(true);
});

test("does nothing when an admin exists or no bootstrap is configured", async () => {
  const db = await testDb();
  const authz = new FakeAuthz();
  const [u] = await db.insert(users).values({ email: "real@example.com", name: "Real" }).returning();
  await db.insert(platformRoles).values({ userId: u!.id, role: "admin" });
  await ensureBootstrapAdmin(db, authz, cfg);
  await ensureBootstrapAdmin(db, authz, undefined);
  expect((await db.select().from(users)).length).toBe(1);
});
