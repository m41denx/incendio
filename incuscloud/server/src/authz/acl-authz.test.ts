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

test("platform relations: admin ⊃ operator ⊃ viewer, from platform roles", async () => {
  const [a, o, v, n] = [await user("a@x", { platform: "admin" }), await user("o@x", { platform: "operator" }), await user("v@x", { platform: "viewer" }), await user("n@x")];
  const rel = async (u: string) => [await authz.check(u, "admin", "platform:main"), await authz.check(u, "operator", "platform:main"), await authz.check(u, "viewer", "platform:main")];
  expect(await rel(a)).toEqual([true, true, true]);
  expect(await rel(o)).toEqual([false, true, true]);
  expect(await rel(v)).toEqual([false, false, true]);
  expect(await rel(n)).toEqual([false, false, false]);
});

test("tenant relations: owner is the membership; admin includes platform admins, not operators", async () => {
  const t = `tenant:${acme}`;
  const rel = async (u: string) => Promise.all(["owner", "admin", "member", "viewer"].map((r) => authz.check(u, r, t)));
  expect(await rel(await user("ow@x", { tenant: "owner" }))).toEqual([true, true, true, true]);
  expect(await rel(await user("ad@x", { tenant: "admin" }))).toEqual([false, true, true, true]);
  expect(await rel(await user("me@x", { tenant: "member" }))).toEqual([false, false, true, true]);
  expect(await rel(await user("vi@x", { tenant: "viewer" }))).toEqual([false, false, false, true]);
  expect(await rel(await user("pa@x", { platform: "admin" }))).toEqual([false, true, true, true]);
  expect((await rel(await user("po@x", { platform: "operator" })))[1]).toBe(false);
  expect(await rel(await user("pv@x", { platform: "viewer" }))).toEqual([false, false, false, true]);
  expect(await rel(await user("no@x"))).toEqual([false, false, false, false]);
});

test("cluster relations: can_access for platform viewers and members of a tenant placed there", async () => {
  const m = await user("m@x", { tenant: "viewer" });
  const pv = await user("pv@x", { platform: "viewer" });
  const pa = await user("pa@x", { platform: "admin" });
  expect([await authz.check(m, "can_access", `cluster:${c}`), await authz.check(m, "can_access", `cluster:${d}`)]).toEqual([true, false]);
  expect(await authz.check(pv, "can_access", `cluster:${d}`)).toBe(true);
  expect([await authz.check(pa, "admin", `cluster:${d}`), await authz.check(pv, "admin", `cluster:${d}`)]).toEqual([true, false]);
  expect(await authz.listObjects(m, "can_access", "cluster")).toEqual([`cluster:${c}`]);
  expect(await authz.listObjects(pv, "can_access", "cluster")).toEqual([`cluster:${c}`, `cluster:${d}`].sort());
});

test("service accounts are passed as user:<id> and resolve as service accounts", async () => {
  const [sa] = await db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-1", tenantId: acme }).returning();
  authz.acl.invalidate();
  expect(await authz.check(`user:${sa!.id}`, "member", `tenant:${acme}`)).toBe(true);
  expect(await authz.check(`user:${sa!.id}`, "admin", `tenant:${acme}`)).toBe(false);
  expect(await authz.listObjects(`user:${sa!.id}`, "member", "tenant")).toEqual([`tenant:${acme}`]);
});

test("unknown objects and relations are false; write() only invalidates", async () => {
  const a = await user("a@x", { platform: "admin" });
  expect(await authz.check(a, "admin", "tenant:00000000-0000-0000-0000-000000000000")).toBe(false);
  expect(await authz.check(a, "nonsense", "platform:main")).toBe(false);
  await authz.check(a, "admin", "platform:main");
  const [l] = await db.insert(users).values({ email: "l@x", name: "l" }).returning();
  await db.insert(platformRoles).values({ userId: l!.id, role: "admin" });
  const later = `user:${l!.id}`;
  expect(await authz.check(later, "admin", "platform:main")).toBe(false);
  await authz.write([]);
  expect(await authz.check(later, "admin", "platform:main")).toBe(true);
});
