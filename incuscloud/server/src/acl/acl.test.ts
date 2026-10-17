import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { aclEntries, clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import type { Principal } from "../auth/principal.ts";
import { ROLES } from "./catalog.ts";
import { Acl } from "./acl.ts";

let db: Db;
let clock = 0;
let acl: Acl;
let acme: string;
const as = (id: string, kind: Principal["kind"] = "user"): Principal => ({ kind, id, name: "x", token: "" });
const user = async (email: string, o: { platform?: string; tenant?: string; disabled?: boolean } = {}) => {
  const [u] = await db.insert(users).values({ email, name: email, disabled: o.disabled ?? false }).returning();
  if (o.platform) await db.insert(platformRoles).values({ userId: u!.id, role: o.platform });
  if (o.tenant) await db.insert(tenantMembers).values({ tenantId: acme, userId: u!.id, role: o.tenant });
  return as(u!.id);
};
const cluster = async (name: string) => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
const grant = (p: Principal, path: string, role: string, propagate = true) =>
  db.insert(aclEntries).values({ path, role, propagate, ...(p.kind === "user" ? { userId: p.id } : { serviceAccountId: p.id }) });

beforeEach(async () => {
  db = await testDb();
  clock = 0;
  acl = new Acl(db, { ttlMs: 2000, now: () => clock });
  acme = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning())[0]!.id;
  const c = await cluster("c");
  await cluster("d");
  await db.insert(placements).values({ tenantId: acme, clusterId: c, project: "acme-c" });
});

test("a platform viewer is an auditor on / (virtual entry)", async () => {
  const v = await user("v@x", { platform: "viewer" });
  expect(await acl.privileges(v, "/clusters/c")).toEqual(new Set(ROLES.auditor.privileges));
  expect((await acl.explain(`user:${v.id}`, "/")).decidedBy).toMatchObject([{ role: "auditor", source: "platform-role" }]);
});

test("a tenant member is an unrestricted user on its tenant and on its project on every cluster", async () => {
  const m = await user("m@x", { tenant: "member" });
  expect(await acl.can(m, "instance.create", "/tenants/acme")).toBe(true);
  expect(await acl.can(m, "instance.power", "/clusters/c/projects/acme-c/instances/web")).toBe(true);
  expect(await acl.can(m, "instance.power", "/clusters/c/projects/default/instances/web")).toBe(false);
  expect(await acl.can(m, "tenant.members", "/tenants/acme")).toBe(false);
});

test("tenant owners and admins are tenant admins; viewers auditors", async () => {
  const o = await user("o@x", { tenant: "owner" });
  const v = await user("v@x", { tenant: "viewer" });
  expect(await acl.can(o, "tenant.members", "/tenants/acme")).toBe(true);
  expect(await acl.can(v, "tenant.view", "/tenants/acme")).toBe(true);
  expect(await acl.can(v, "instance.power", "/tenants/acme")).toBe(false);
});

test("a tenant service account acts as unrestricted user on its tenant; a platform one as its role", async () => {
  const [t] = await db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-1", tenantId: acme }).returning();
  const [p] = await db.insert(serviceAccounts).values({ name: "ops", clientId: "sa-2", platformRole: "operator" }).returning();
  expect(await acl.can(as(t!.id, "service"), "instance.create", "/tenants/acme")).toBe(true);
  expect(await acl.can(as(p!.id, "service"), "cluster.configure", "/clusters/d")).toBe(true);
});

test("an explicit no-access on /clusters/c removes cluster c from a platform operator, and sees() is false", async () => {
  const op = await user("op@x", { platform: "operator" });
  await grant(op, "/clusters/c", "no-access");
  expect(await acl.can(op, "cluster.view", "/clusters/c")).toBe(false);
  expect(await acl.sees(op, "/clusters/c")).toBe(false);
  expect(await acl.can(op, "cluster.configure", "/clusters/d")).toBe(true);
});

test("a platform admin who is a tenant viewer is an auditor on that tenant", async () => {
  const a = await user("a@x", { platform: "admin", tenant: "viewer" });
  expect(await acl.can(a, "instance.power", "/tenants/acme")).toBe(false);
  expect(await acl.can(a, "tenant.view", "/tenants/acme")).toBe(true);
  expect(await acl.can(a, "platform.users", "/")).toBe(true);
});

test("a disabled user or service account resolves to nothing", async () => {
  const u = await user("d@x", { platform: "admin", disabled: true });
  const [sa] = await db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-3", platformRole: "admin", disabled: true }).returning();
  expect((await acl.privileges(u, "/")).size).toBe(0);
  expect((await acl.privileges(as(sa!.id, "service"), "/")).size).toBe(0);
});

test("sees() is true for a cluster when the only entry is on its tenant's project there", async () => {
  const u = await user("p@x");
  await grant(u, "/clusters/c/projects/acme-c", "auditor");
  expect(await acl.sees(u, "/clusters/c")).toBe(true);
  expect(await acl.sees(u, "/clusters/d")).toBe(false);
  expect(await acl.sees(u, "/")).toBe(true);
  // A tenant entry makes the clusters it is placed on visible.
  const m = await user("m@x", { tenant: "viewer" });
  acl.invalidate();
  expect(await acl.sees(m, "/clusters/c")).toBe(true);
  expect(await acl.sees(m, "/clusters/d")).toBe(false);
});

test("changes are seen after invalidate(), and after the TTL without it", async () => {
  const u = await user("u@x");
  expect(await acl.can(u, "cluster.view", "/clusters/c")).toBe(false);
  await grant(u, "/clusters/c", "auditor");
  expect(await acl.can(u, "cluster.view", "/clusters/c")).toBe(false);
  acl.invalidate();
  expect(await acl.can(u, "cluster.view", "/clusters/c")).toBe(true);
  await db.delete(aclEntries);
  clock += 1999;
  expect(await acl.can(u, "cluster.view", "/clusters/c")).toBe(true);
  clock += 2;
  expect(await acl.can(u, "cluster.view", "/clusters/c")).toBe(false);
});

test("entries() lists explicit and virtual entries; deleting a user cascades its explicit ones", async () => {
  const u = await user("u@x", { platform: "viewer" });
  await grant(u, "/clusters/c", "operator");
  expect((await acl.entries()).map((e) => [e.path, e.role, e.source])).toEqual(expect.arrayContaining([["/", "auditor", "platform-role"], ["/clusters/c", "operator", "acl"]]));
  await db.delete(users).where(eq(users.id, u.id));
  expect(await db.select().from(aclEntries)).toEqual([]);
});
