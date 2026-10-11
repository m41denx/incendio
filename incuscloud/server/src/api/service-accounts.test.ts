import { beforeEach, expect, test } from "bun:test";
import { harness, type Actor } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let t: { id: string };
let ta: Actor;
beforeEach(async () => {
  h = await harness();
  t = await h.tenant("acme");
  ta = await h.user("ta@example.com", { tenants: { [t.id]: "admin" } });
});

test("tenant admins create tenant service accounts; the secret is shown once", async () => {
  const r = await h.call(ta, "POST", "/api/v1/service-accounts", { name: "ci", tenantId: t.id });
  expect(r.status).toBe(201);
  expect(r.body.clientId).toBe(`sa-${r.body.id}`);
  expect(r.body.clientSecret.length).toBeGreaterThan(30);
  expect(r.body.tokenUrl).toBe("https://id.test/oauth2/token");
  const client = h.hydra.clients.get(r.body.clientId)!;
  expect(client).toMatchObject({ grant_types: ["client_credentials"], audience: ["incuscloud"], access_token_strategy: "jwt" });
  expect(await h.authz.check(`user:${r.body.id}`, "member", `tenant:${t.id}`)).toBe(true);
  const list = await h.call(ta, "GET", "/api/v1/service-accounts");
  expect(list.body.map((s: { name: string }) => s.name)).toEqual(["ci"]);
  expect(list.body[0].clientSecret).toBeUndefined();
});

test("service accounts cannot be created in other tenants or by members", async () => {
  const other = await h.tenant("other");
  expect((await h.call(ta, "POST", "/api/v1/service-accounts", { name: "x", tenantId: other.id })).status).toBe(404);
  const m = await h.user("m@example.com", { tenants: { [t.id]: "member" } });
  expect((await h.call(m, "POST", "/api/v1/service-accounts", { name: "x", tenantId: t.id })).status).toBe(403);
});

test("platform-level service accounts need a platform admin", async () => {
  expect((await h.call(ta, "POST", "/api/v1/service-accounts", { name: "x" })).status).toBe(403);
  const admin = await h.user("a@example.com", { platformRole: "admin" });
  const r = await h.call(admin, "POST", "/api/v1/service-accounts", { name: "ops-bot", platformRole: "operator" });
  expect(r.status).toBe(201);
  expect(await h.authz.check(`user:${r.body.id}`, "operator", "platform:main")).toBe(true);
});

test("rotation replaces the secret", async () => {
  const sa = (await h.call(ta, "POST", "/api/v1/service-accounts", { name: "ci", tenantId: t.id })).body;
  const r = await h.call(ta, "POST", `/api/v1/service-accounts/${sa.id}/rotate`);
  expect(r.status).toBe(200);
  expect(r.body.clientSecret).not.toBe(sa.clientSecret);
  expect(h.hydra.clients.get(sa.clientId)!.client_secret).toBe(r.body.clientSecret);
});

test("deleted service accounts lose their client and their tokens", async () => {
  const sa = (await h.call(ta, "POST", "/api/v1/service-accounts", { name: "ci", tenantId: t.id })).body;
  const token = await h.sign({ sub: sa.clientId });
  expect((await h.call({ id: sa.id, token }, "GET", "/api/v1/me")).status).toBe(200);
  expect((await h.call(ta, "DELETE", `/api/v1/service-accounts/${sa.id}`)).status).toBe(204);
  expect(h.hydra.clients.has(sa.clientId)).toBe(false);
  expect((await h.call({ id: sa.id, token }, "GET", "/api/v1/me")).status).toBe(401);
  expect(await h.authz.check(`user:${sa.id}`, "member", `tenant:${t.id}`)).toBe(false);
});

test("other tenants' admins cannot see or delete a service account", async () => {
  const sa = (await h.call(ta, "POST", "/api/v1/service-accounts", { name: "ci", tenantId: t.id })).body;
  const other = await h.tenant("other");
  const oa = await h.user("oa@example.com", { tenants: { [other.id]: "admin" } });
  expect((await h.call(oa, "GET", "/api/v1/service-accounts")).body).toEqual([]);
  expect((await h.call(oa, "DELETE", `/api/v1/service-accounts/${sa.id}`)).status).toBe(404);
});
