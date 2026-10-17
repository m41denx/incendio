import { beforeEach, expect, test } from "bun:test";
import { clusters, placements } from "../db/schema.ts";
import { harness, type Actor } from "../test/harness.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";

let h: Awaited<ReturnType<typeof harness>>;
let op: Actor;
beforeEach(async () => {
  h = await harness();
  op = await h.user("op@example.com", { platformRole: "operator" });
});

test("operators create tenants, optionally with an owner", async () => {
  const owner = await h.user("o@example.com");
  const r = await h.call(op, "POST", "/api/v1/tenants", { slug: "acme", name: "Acme", ownerId: owner.id });
  expect(r.status).toBe(201);
  expect(await h.owns(owner.id, r.body.id)).toBe(true);
  expect(await h.can(op.id, "acl.manage", "/tenants/acme")).toBe(false);
  expect((await h.call(op, "GET", `/api/v1/tenants/${r.body.id}/members`)).body).toEqual([{ userId: owner.id, email: "o@example.com", name: "o", role: "owner" }]);
});

test("slugs are validated and unique", async () => {
  expect((await h.call(op, "POST", "/api/v1/tenants", { slug: "Bad Slug", name: "x" })).status).toBe(400);
  expect((await h.call(op, "POST", "/api/v1/tenants", { slug: "default", name: "x" })).status).toBe(400);
  await h.call(op, "POST", "/api/v1/tenants", { slug: "acme", name: "x" });
  expect((await h.call(op, "POST", "/api/v1/tenants", { slug: "acme", name: "y" })).status).toBe(409);
});

test("plain users cannot create tenants", async () => {
  const u = await h.user("u@example.com");
  expect((await h.call(u, "POST", "/api/v1/tenants", { slug: "mine", name: "x" })).status).toBe(403);
});

test("members see their tenants; platform viewers see all", async () => {
  const [a, b] = [await h.tenant("aaa"), await h.tenant("bbb")];
  const m = await h.user("m@example.com", { tenants: { [a.id]: "member" } });
  expect((await h.call(m, "GET", "/api/v1/tenants")).body.map((t: { slug: string }) => t.slug)).toEqual(["aaa"]);
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  expect((await h.call(v, "GET", "/api/v1/tenants")).body.map((t: { slug: string }) => t.slug)).toEqual(["aaa", "bbb"]);
  expect((await h.call(m, "GET", `/api/v1/tenants/${b.id}`)).status).toBe(404);
});

test("a tenant admin cannot act on another tenant", async () => {
  const [a, b] = [await h.tenant("aaa"), await h.tenant("bbb")];
  const ta = await h.user("ta@example.com", { tenants: { [a.id]: "admin" } });
  const victim = await h.user("x@example.com");
  expect((await h.call(ta, "PATCH", `/api/v1/tenants/${b.id}`, { name: "pwned" })).status).toBe(404);
  expect((await h.call(ta, "PUT", `/api/v1/tenants/${b.id}/members/${victim.id}`, { role: "member" })).status).toBe(404);
  expect((await h.call(ta, "PATCH", `/api/v1/tenants/${a.id}`, { name: "Renamed" })).status).toBe(200);
});

test("tenant admins manage members but only owners make owners", async () => {
  const t = await h.tenant("acme");
  const owner = await h.user("o@example.com", { tenants: { [t.id]: "owner" } });
  const ta = await h.user("ta@example.com", { tenants: { [t.id]: "admin" } });
  const u = await h.user("u@example.com");
  expect((await h.call(ta, "PUT", `/api/v1/tenants/${t.id}/members/${u.id}`, { role: "member" })).status).toBe(200);
  expect(await h.can(u.id, "instance.create", "/tenants/acme")).toBe(true);
  expect((await h.call(ta, "PUT", `/api/v1/tenants/${t.id}/members/${u.id}`, { role: "owner" })).status).toBe(403);
  expect((await h.call(owner, "PUT", `/api/v1/tenants/${t.id}/members/${u.id}`, { role: "owner" })).status).toBe(200);
  // Role changes replace the old tuple.
  expect(await h.owns(u.id, t.id)).toBe(true);
  expect((await h.call(owner, "PUT", `/api/v1/tenants/${t.id}/members/${u.id}`, { role: "viewer" })).status).toBe(200);
  expect(await h.owns(u.id, t.id)).toBe(false);
  expect(await h.can(u.id, "tenant.view", "/tenants/acme")).toBe(true);
});

test("tenant admins cannot demote or remove owners", async () => {
  const t = await h.tenant("acme");
  const o1 = await h.user("o1@example.com", { tenants: { [t.id]: "owner" } });
  const ta = await h.user("ta@example.com", { tenants: { [t.id]: "admin" } });
  expect((await h.call(ta, "PUT", `/api/v1/tenants/${t.id}/members/${o1.id}`, { role: "member" })).status).toBe(403);
  expect((await h.call(ta, "DELETE", `/api/v1/tenants/${t.id}/members/${o1.id}`)).status).toBe(403);
});

test("platform roles are not grantable through membership", async () => {
  const t = await h.tenant("acme");
  const owner = await h.user("o@example.com", { tenants: { [t.id]: "owner" } });
  const u = await h.user("u@example.com");
  for (const role of ["platform-admin", "operator", "god"]) {
    expect((await h.call(owner, "PUT", `/api/v1/tenants/${t.id}/members/${u.id}`, { role })).status).toBe(400);
  }
});

test("the last owner cannot be removed or demoted", async () => {
  const t = await h.tenant("acme");
  const owner = await h.user("o@example.com", { tenants: { [t.id]: "owner" } });
  expect((await h.call(owner, "DELETE", `/api/v1/tenants/${t.id}/members/${owner.id}`)).status).toBe(409);
  expect((await h.call(owner, "PUT", `/api/v1/tenants/${t.id}/members/${owner.id}`, { role: "admin" })).status).toBe(409);
});

test("members can be added by email", async () => {
  const t = await h.tenant("acme");
  const owner = await h.user("o@example.com", { tenants: { [t.id]: "owner" } });
  const u = await h.user("new@example.com");
  expect((await h.call(owner, "POST", `/api/v1/tenants/${t.id}/members`, { email: "NEW@example.com", role: "member" })).status).toBe(200);
  expect(await h.can(u.id, "instance.create", "/tenants/acme")).toBe(true);
  expect((await h.call(owner, "POST", `/api/v1/tenants/${t.id}/members`, { email: "ghost@example.com", role: "member" })).status).toBe(404);
});

test("quotas are set by the platform, not by tenant admins", async () => {
  const t = await h.tenant("acme");
  const owner = await h.user("o@example.com", { tenants: { [t.id]: "owner" } });
  expect((await h.call(owner, "PATCH", `/api/v1/tenants/${t.id}`, { quotas: { instances: 999 } })).status).toBe(403);
  const r = await h.call(op, "PATCH", `/api/v1/tenants/${t.id}`, { quotas: { instances: 10 } });
  expect(r.body.quotas).toEqual({ instances: 10 });
});

test("tenants placed on clusters cannot be deleted", async () => {
  const t = await h.tenant("acme");
  const admin = await h.user("a@example.com", { platformRole: "admin" });
  const [c] = await h.db.insert(clusters).values({ name: "c1", url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning();
  await h.db.insert(placements).values({ tenantId: t.id, clusterId: c!.id, project: "acme" });
  expect((await h.call(admin, "DELETE", `/api/v1/tenants/${t.id}`)).status).toBe(409);
  await h.db.delete(placements);
  expect((await h.call(admin, "DELETE", `/api/v1/tenants/${t.id}`)).status).toBe(204);
  expect((await h.acl.lookup()).tenantSlugs.has(t.id)).toBe(false);
});

test("a tenant's placements: where it runs, for anyone who can see the tenant", async () => {
  const fake = await new FakeIncus().start();
  try {
    const admin = await h.user("pa@example.com", { platformRole: "admin" });
    const c = (await h.call(admin, "POST", "/api/v1/clusters", { name: "c1", token: fake.token() })).body;
    const t = await h.tenant("acme");
    const viewer = await h.user("tv@example.com", { tenants: { [t.id]: "viewer" } });
    const outsider = await h.user("o@example.com");
    await h.call(admin, "PUT", `/api/v1/clusters/${c.id}/tenants/${t.id}`);
    const r = await h.call(viewer, "GET", `/api/v1/tenants/${t.id}/placements`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([expect.objectContaining({ clusterId: c.id, clusterName: "c1", project: "acme", status: "pending", statusMessage: "" })]);
    expect((await h.call(outsider, "GET", `/api/v1/tenants/${t.id}/placements`)).status).toBe(404);
  } finally {
    fake.stop();
  }
});

test("tenant admins cannot make platform staff members (that would narrow them); an admin adding themself is told", async () => {
  const t = await h.tenant("acme");
  const ta = await h.user("ta@example.com", { tenants: { [t.id]: "admin" } });
  const root = await h.user("root2@example.com", { platformRole: "admin" });
  expect((await h.call(ta, "POST", `/api/v1/tenants/${t.id}/members`, { email: "root2@example.com", role: "viewer" })).status).toBe(403);
  const r = await h.call(root, "POST", `/api/v1/tenants/${t.id}/members`, { email: "root2@example.com", role: "viewer" });
  expect([r.status, r.body.replacesPlatformRole]).toEqual([200, "admin"]);
});
