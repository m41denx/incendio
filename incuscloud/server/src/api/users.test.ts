import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, sessions, users } from "../db/schema.ts";
import { harness, type Actor } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let admin: Actor;
beforeEach(async () => {
  h = await harness();
  admin = await h.user("root@example.com", { platformRole: "admin" });
});

test("only platform viewers and up can list users", async () => {
  const t = await h.tenant("acme");
  const member = await h.user("m@example.com", { tenants: { [t.id]: "admin" } });
  expect((await h.call(member, "GET", "/api/v1/users")).status).toBe(403);
  const viewer = await h.user("v@example.com", { platformRole: "viewer" });
  const r = await h.call(viewer, "GET", "/api/v1/users");
  expect(r.status).toBe(200);
  expect(r.body.map((u: { email: string }) => u.email).sort()).toEqual(["m@example.com", "root@example.com", "v@example.com"]);
  expect(r.body[0].passwordHash).toBeUndefined();
});

test("admins create users with a platform role; the action is audited", async () => {
  const r = await h.call(admin, "POST", "/api/v1/users", { email: "op@example.com", name: "Op", password: "pw-long-enough-1", platformRole: "operator" });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ email: "op@example.com", platformRole: "operator" });
  expect(await h.authz.check(`user:${r.body.id}`, "operator", "platform:main")).toBe(true);
  const [a] = await h.db.select().from(auditLog).where(eq(auditLog.action, "user.create"));
  expect(a).toMatchObject({ actorId: admin.id, targetId: r.body.id, result: "success" });
});

test("bad input: duplicate email 409, short password 400, unknown role 400", async () => {
  expect((await h.call(admin, "POST", "/api/v1/users", { email: "ROOT@example.com", name: "x" })).status).toBe(409);
  expect((await h.call(admin, "POST", "/api/v1/users", { email: "a@example.com", name: "x", password: "short" })).status).toBe(400);
  expect((await h.call(admin, "POST", "/api/v1/users", { email: "b@example.com", name: "x", platformRole: "god" })).status).toBe(400);
});

test("operators cannot manage users, and the denial is audited", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  expect((await h.call(op, "POST", "/api/v1/users", { email: "x@example.com", name: "x" })).status).toBe(403);
  const [a] = await h.db.select().from(auditLog).where(eq(auditLog.action, "user.create"));
  expect(a).toMatchObject({ actorId: op.id, result: "denied" });
});

test("disabling a user ends their sessions and invalidates their tokens", async () => {
  const u = await h.user("u@example.com");
  await h.db.insert(sessions).values({ id: "s1", userId: u.id, accessToken: "t", expiresAt: new Date(Date.now() + 3600e3) });
  expect((await h.call(admin, "PATCH", `/api/v1/users/${u.id}`, { disabled: true })).status).toBe(200);
  expect(await h.db.select().from(sessions)).toEqual([]);
  expect((await h.call(u, "GET", "/api/v1/me")).status).toBe(401);
});

test("platform role changes reach the authorizer", async () => {
  const u = await h.user("u@example.com");
  await h.call(admin, "PATCH", `/api/v1/users/${u.id}`, { platformRole: "viewer" });
  expect(await h.authz.check(`user:${u.id}`, "viewer", "platform:main")).toBe(true);
  await h.call(admin, "PATCH", `/api/v1/users/${u.id}`, { platformRole: null });
  expect(await h.authz.check(`user:${u.id}`, "viewer", "platform:main")).toBe(false);
});

test("the last platform admin cannot be demoted, disabled or deleted", async () => {
  expect((await h.call(admin, "PATCH", `/api/v1/users/${admin.id}`, { platformRole: "viewer" })).status).toBe(409);
  expect((await h.call(admin, "PATCH", `/api/v1/users/${admin.id}`, { disabled: true })).status).toBe(409);
  expect((await h.call(admin, "DELETE", `/api/v1/users/${admin.id}`)).status).toBe(409);
  const second = await h.user("second@example.com", { platformRole: "admin" });
  expect((await h.call(second, "PATCH", `/api/v1/users/${admin.id}`, { platformRole: "viewer" })).status).toBe(200);
});

test("deleting a user removes their tuples", async () => {
  const t = await h.tenant("acme");
  const u = await h.user("u@example.com", { tenants: { [t.id]: "member" } });
  expect((await h.call(admin, "DELETE", `/api/v1/users/${u.id}`)).status).toBe(204);
  expect(await h.db.select().from(users).where(eq(users.id, u.id))).toEqual([]);
  expect(await h.authz.check(`user:${u.id}`, "member", `tenant:${t.id}`)).toBe(false);
});

test("unknown ids are 404", async () => {
  expect((await h.call(admin, "GET", `/api/v1/users/${crypto.randomUUID()}`)).status).toBe(404);
  expect((await h.call(admin, "GET", "/api/v1/users/not-a-uuid")).status).toBe(404);
});
