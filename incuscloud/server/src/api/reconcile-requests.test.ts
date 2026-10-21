import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { isNotNull } from "drizzle-orm";
import { clusters } from "../db/schema.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { harness, type Actor } from "../test/harness.ts";

let fake: FakeIncus;
let h: Awaited<ReturnType<typeof harness>>;
let admin: Actor;
let c1: string;
let c2: string;
let tenant: string;
beforeAll(async () => {
  fake = await new FakeIncus().start();
});
afterAll(() => fake.stop());
beforeEach(async () => {
  h = await harness();
  admin = await h.user("a@example.com", { platformRole: "admin" });
  c1 = (await h.call(admin, "POST", "/api/v1/clusters", { name: "c1", token: fake.token() })).body.id;
  c2 = (await h.call(admin, "POST", "/api/v1/clusters", { name: "c2", token: fake.token() })).body.id;
  tenant = (await h.call(admin, "POST", "/api/v1/tenants", { slug: "acme", name: "Acme" })).body.id;
  await h.call(admin, "PUT", `/api/v1/clusters/${c1}/tenants/${tenant}`);
  await clear();
});

const clear = () => h.db.update(clusters).set({ reconcileRequestedAt: null });
const requested = async () => {
  const rows = await h.db.select({ id: clusters.id }).from(clusters).where(isNotNull(clusters.reconcileRequestedAt));
  return rows.map((r) => (r.id === c1 ? "c1" : r.id === c2 ? "c2" : r.id)).sort();
};

test("enrolling and placing request the cluster", async () => {
  const c3 = (await h.call(admin, "POST", "/api/v1/clusters", { name: "c3", token: fake.token() })).body.id;
  expect(await requested()).toEqual([c3]);
  await clear();
  await h.call(admin, "PUT", `/api/v1/clusters/${c2}/tenants/${tenant}`);
  expect(await requested()).toEqual(["c2"]);
  await clear();
  await h.call(admin, "DELETE", `/api/v1/clusters/${c2}/tenants/${tenant}`);
  expect(await requested()).toEqual(["c2"]);
});

test("tenant changes request the clusters the tenant is on", async () => {
  const bob = await h.user("bob@example.com");
  expect((await h.call(admin, "PUT", `/api/v1/tenants/${tenant}/members/${bob.id}`, { role: "member" })).status).toBe(200);
  expect(await requested()).toEqual(["c1"]);
  await clear();
  await h.call(admin, "DELETE", `/api/v1/tenants/${tenant}/members/${bob.id}`);
  expect(await requested()).toEqual(["c1"]);
  await clear();
  await h.call(admin, "PATCH", `/api/v1/tenants/${tenant}`, { quotas: { cpu: 4 } });
  expect(await requested()).toEqual(["c1"]);
  await clear();
  const sa = await h.call(admin, "POST", "/api/v1/service-accounts", { name: "ci", tenantId: tenant });
  expect(sa.status).toBe(201);
  expect(await requested()).toEqual(["c1"]);
  await clear();
  await h.call(admin, "DELETE", `/api/v1/service-accounts/${sa.body.id}`);
  expect(await requested()).toEqual(["c1"]);
});

test("user and platform changes request every cluster", async () => {
  const bob = await h.user("bob@example.com");
  await h.call(admin, "PATCH", `/api/v1/users/${bob.id}`, { disabled: true });
  expect(await requested()).toEqual(["c1", "c2"]);
  await clear();
  await h.call(admin, "DELETE", `/api/v1/users/${bob.id}`);
  expect(await requested()).toEqual(["c1", "c2"]);
  await clear();
  await h.call(admin, "POST", "/api/v1/users", { email: "op@example.com", name: "Op", platformRole: "operator" });
  expect(await requested()).toEqual(["c1", "c2"]);
  await clear();
  await h.call(admin, "POST", "/api/v1/service-accounts", { name: "ops", platformRole: "viewer" });
  expect(await requested()).toEqual(["c1", "c2"]);
});

test("operators can ask for a reconcile; viewers cannot", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  const viewer = await h.user("v@example.com", { platformRole: "viewer" });
  expect((await h.call(viewer, "POST", `/api/v1/clusters/${c2}/reconcile`)).status).toBe(403);
  expect(await requested()).toEqual([]);
  expect((await h.call(op, "POST", `/api/v1/clusters/${c2}/reconcile`)).status).toBe(202);
  expect(await requested()).toEqual(["c2"]);
  const view = (await h.call(op, "GET", `/api/v1/clusters/${c2}`)).body;
  expect(view).toHaveProperty("reconciledAt");
  expect(view.reconcileRequestedAt).toBeTruthy();
});
