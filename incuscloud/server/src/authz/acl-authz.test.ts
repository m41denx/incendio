import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import { Acl } from "../acl/acl.ts";
import { AclAuthz } from "./acl-authz.ts";

let db: Db;
let authz: AclAuthz;
let acme: string;
let c: string;
let d: string;
const user = async (email: string, o: { platform?: string; tenant?: string } = {}) => {
  const [u] = await db.insert(users).values({ email, name: email }).returning();
  if (o.platform) await db.insert(platformRoles).values({ userId: u!.id, role: o.platform });
  if (o.tenant) await db.insert(tenantMembers).values({ tenantId: acme, userId: u!.id, role: o.tenant });
  authz.acl.invalidate();
  return `user:${u!.id}`;
};
const cluster = async (name: string) => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;

beforeEach(async () => {
  db = await testDb();
  authz = new AclAuthz(db, new Acl(db));
  acme = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning())[0]!.id;
  c = await cluster("c");
  d = await cluster("d");
  await db.insert(placements).values({ tenantId: acme, clusterId: c, project: "acme" });
});

test("the old relations are gone: only can_access is answered", async () => {
  const a = await user("a@x", { platform: "admin" });
  expect(await authz.check(a, "admin", "platform:main")).toBe(false);
  expect(await authz.check(await user("ow@x", { tenant: "owner" }), "owner", `tenant:${acme}`)).toBe(false);
  expect(await authz.check(a, "admin", `cluster:${c}`)).toBe(false);
});

test("can_access: platform viewers everywhere, members of a tenant placed there on that cluster", async () => {
  const m = await user("m@x", { tenant: "viewer" });
  const pv = await user("pv@x", { platform: "viewer" });
  expect([await authz.check(m, "can_access", `cluster:${c}`), await authz.check(m, "can_access", `cluster:${d}`)]).toEqual([true, false]);
  expect(await authz.check(pv, "can_access", `cluster:${d}`)).toBe(true);
  expect(await authz.listObjects(m, "can_access", "cluster")).toEqual([`cluster:${c}`]);
  expect(await authz.listObjects(pv, "can_access", "cluster")).toEqual([`cluster:${c}`, `cluster:${d}`].sort());
});

test("service accounts are passed as user:<id> and resolve as service accounts", async () => {
  const [sa] = await db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-1", tenantId: acme }).returning();
  authz.acl.invalidate();
  expect(await authz.check(`user:${sa!.id}`, "can_access", `cluster:${c}`)).toBe(true);
  expect(await authz.check(`user:${sa!.id}`, "can_access", `cluster:${d}`)).toBe(false);
});

test("unknown objects and relations are false; write() only invalidates", async () => {
  const a = await user("a@x", { platform: "viewer" });
  expect(await authz.check(a, "can_access", "cluster:00000000-0000-0000-0000-000000000000")).toBe(false);
  expect(await authz.check(a, "nonsense", `cluster:${c}`)).toBe(false);
  const [l] = await db.insert(users).values({ email: "l@x", name: "l" }).returning();
  await db.insert(platformRoles).values({ userId: l!.id, role: "viewer" });
  const later = `user:${l!.id}`;
  expect(await authz.check(later, "can_access", `cluster:${d}`)).toBe(false);
  await authz.write([]);
  expect(await authz.check(later, "can_access", `cluster:${d}`)).toBe(true);
});
