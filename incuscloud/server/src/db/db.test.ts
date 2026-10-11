import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "./test-db.ts";
import { auditLog, clusters, tenantMembers, tenants, users } from "./schema.ts";

test("migrations apply and emails are unique case-insensitively", async () => {
  const db = await testDb();
  await db.insert(users).values({ email: "Ada@Example.com", name: "Ada" });
  await expect(Promise.resolve(db.insert(users).values({ email: "ada@example.com", name: "dup" }))).rejects.toThrow();
  const [found] = await db.select().from(users).where(eq(users.email, "ADA@EXAMPLE.COM"));
  expect(found?.name).toBe("Ada");
});

test("tenant member roles are constrained", async () => {
  const db = await testDb();
  const [u] = await db.insert(users).values({ email: "m@example.com", name: "M" }).returning();
  const [t] = await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning();
  await db.insert(tenantMembers).values({ tenantId: t!.id, userId: u!.id, role: "member" });
  await expect(Promise.resolve(db.insert(tenantMembers).values({ tenantId: t!.id, userId: u!.id, role: "god" }))).rejects.toThrow();
});

test("clusters, audit rows and defaults", async () => {
  const db = await testDb();
  const [c] = await db
    .insert(clusters)
    .values({ name: "c1", url: "https://h:8443", fingerprint: "ab", serverCert: "pem", clientCert: "pem", clientKeyEnc: "v1.x.y" })
    .returning();
  expect(c!.status).toBe("pending");
  expect(c!.labels).toEqual({});
  expect(c!.addresses).toEqual([]);
  await db.insert(auditLog).values({ actorType: "user", actorId: "u", action: "cluster.enroll", targetType: "cluster", targetId: c!.id, result: "success" });
  const rows = await db.select().from(auditLog);
  expect(rows[0]!.at).toBeInstanceOf(Date);
});

test("openDb understands pglite: URLs (development) and migrates", async () => {
  const { openDb } = await import("./index.ts");
  const db = await openDb("pglite:memory");
  await db.insert(users).values({ email: "dev@example.com", name: "Dev" });
  expect((await db.select().from(users)).length).toBe(1);
});
