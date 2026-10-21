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

test("clusters made from a size get that size's spec, pinned to their load balancer's member", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { citext } = await import("@electric-sql/pglite/contrib/citext");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { migrationsFolder } = await import("./index.ts");
  const { sql } = await import("drizzle-orm");
  // The migrations up to 0011, as a database made before specs has them.
  const before = mkdtempSync(join(tmpdir(), "ic-mig-"));
  try {
    cpSync(migrationsFolder, before, { recursive: true });
    const journal = JSON.parse(readFileSync(join(before, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < "0012");
    writeFileSync(join(before, "meta/_journal.json"), JSON.stringify(journal));
    const db = drizzle(new PGlite({ extensions: { citext } }));
    await migrate(db, { migrationsFolder: before });
    await db.execute(sql`insert into tenants (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'acme', 'Acme')`);
    await db.execute(sql`insert into clusters (id, name, url, fingerprint, server_cert, client_cert, client_key_enc) values ('00000000-0000-0000-0000-000000000002', 'c1', 'https://c1:8443', 'f', 's', 'c', 'k')`);
    await db.execute(sql`insert into k8s_clusters (tenant_id, cluster_id, name, namespace, version, control_planes, workers, size, endpoint_host, endpoint_port, lb_member, created_by)
      values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'dev', 'ic-acme', 'v1.35.5', 1, 1, 'large', '10.0.0.1', 16443, 'd1', 'u')`);
    await migrate(db, { migrationsFolder });
    const r = await db.execute(sql`select spec, size from k8s_clusters`);
    const row = (r as unknown as { rows: Array<{ spec: Record<string, any>; size: string }> }).rows[0]!;
    expect(row.size).toBe("large");
    expect(row.spec.controlPlane).toEqual({ type: "container", flavor: "c4-m8", profiles: ["default"], target: "d1" });
    expect(row.spec.loadBalancer).toEqual({ type: "lxc", flavor: "c1-m1", profiles: ["default"], target: "d1" });
    expect(row.spec).toMatchObject({ flannel: true, privileged: false, podCidr: "10.244.0.0/16", serviceCidr: "10.96.0.0/12", metallb: null, image: "", installKubeadm: false });
  } finally {
    rmSync(before, { recursive: true, force: true });
  }
}, 60_000);
