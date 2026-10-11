import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { auditLog, placements } from "../db/schema.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { harness, type Actor } from "../test/harness.ts";

let fake: FakeIncus;
let h: Awaited<ReturnType<typeof harness>>;
let admin: Actor;
beforeAll(async () => {
  fake = await new FakeIncus().start();
});
afterAll(() => fake.stop());
beforeEach(async () => {
  h = await harness();
  admin = await h.user("a@example.com", { platformRole: "admin" });
});

const enrol = async (name = "c1") => h.call(admin, "POST", "/api/v1/clusters", { name, token: fake.token(), labels: { region: "eu" } });

test("platform admins enrol clusters; secrets never leave the server", async () => {
  const r = await enrol();
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ name: "c1", status: "ready", labels: { region: "eu" } });
  expect(JSON.stringify(r.body)).not.toContain("PRIVATE KEY");
  expect(r.body.clientKeyEnc).toBeUndefined();
  expect(await h.authz.check(`user:${admin.id}`, "admin", `cluster:${r.body.id}`)).toBe(true);
  const audits = await h.db.select().from(auditLog);
  expect(audits.find((a) => a.action === "cluster.enroll")).toMatchObject({ result: "success", targetId: r.body.id });
});

test("others cannot enrol; bad tokens are 400", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  expect((await h.call(op, "POST", "/api/v1/clusters", { name: "c9", token: fake.token() })).status).toBe(403);
  expect((await h.call(admin, "POST", "/api/v1/clusters", { name: "c9", token: "garbage" })).status).toBe(400);
  expect((await h.call(admin, "POST", "/api/v1/clusters", { name: "Bad Name", token: fake.token() })).status).toBe(400);
});

test("tenants see only clusters they are placed on", async () => {
  const c1 = (await enrol("c1")).body;
  await enrol("c2");
  const t = await h.tenant("acme");
  const m = await h.user("m@example.com", { tenants: { [t.id]: "member" } });
  expect((await h.call(m, "GET", "/api/v1/clusters")).body).toEqual([]);
  const op = await h.user("op@example.com", { platformRole: "operator" });
  const p = await h.call(op, "PUT", `/api/v1/clusters/${c1.id}/tenants/${t.id}`);
  expect(p.status).toBe(200);
  expect(p.body).toMatchObject({ project: "acme", status: "pending" });
  expect((await h.call(m, "GET", "/api/v1/clusters")).body.map((c: { name: string }) => c.name)).toEqual(["c1"]);
  expect((await h.call(m, "GET", `/api/v1/clusters/${c1.id}`)).status).toBe(200);
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  expect((await h.call(v, "GET", "/api/v1/clusters")).body.map((c: { name: string }) => c.name)).toEqual(["c1", "c2"]);
});

test("tenant members cannot place or change clusters", async () => {
  const c1 = (await enrol()).body;
  const t = await h.tenant("acme");
  const owner = await h.user("o@example.com", { tenants: { [t.id]: "owner" } });
  expect((await h.call(owner, "PUT", `/api/v1/clusters/${c1.id}/tenants/${t.id}`)).status).toBe(404);
  expect((await h.call(owner, "PATCH", `/api/v1/clusters/${c1.id}`, { labels: {} })).status).toBe(404);
});

test("deleting a cluster removes our certificate from it", async () => {
  const c1 = (await enrol()).body;
  expect((await h.call(admin, "DELETE", `/api/v1/clusters/${c1.id}`)).status).toBe(204);
  expect(fake.deletedCertificates.length).toBe(1);
  expect((await h.call(admin, "GET", `/api/v1/clusters/${c1.id}`)).status).toBe(404);
});

test("a deleted cluster stops trusting IncusCloud tokens (the reconciler's oidc/authorization keys are unset)", async () => {
  const c1 = (await enrol()).body;
  fake.config = { "oidc.issuer": "https://id.test/", "oidc.client.id": "incus-cli", "oidc.audience": "incuscloud", "oidc.claim": "sub", "authorization.openfga.api.url": "http://fga", "authorization.openfga.api.token": "k", "authorization.openfga.store.id": "S", "authorization.client.oidc": "openfga", "authorization.client.tls": "allow", "core.https_address": ":8443" };
  expect((await h.call(admin, "DELETE", `/api/v1/clusters/${c1.id}`)).status).toBe(204);
  expect(fake.config).toEqual({ "core.https_address": ":8443" });
});

test("clusters with tenants need force to delete", async () => {
  const c1 = (await enrol()).body;
  const t = await h.tenant("acme");
  await h.call(admin, "PUT", `/api/v1/clusters/${c1.id}/tenants/${t.id}`);
  expect((await h.call(admin, "DELETE", `/api/v1/clusters/${c1.id}`)).status).toBe(409);
  expect((await h.call(admin, "DELETE", `/api/v1/clusters/${c1.id}?force=true`)).status).toBe(204);
  expect(await h.db.select().from(placements)).toEqual([]);
});

test("unplacing a tenant removes its access", async () => {
  const c1 = (await enrol()).body;
  const t = await h.tenant("acme");
  const m = await h.user("m@example.com", { tenants: { [t.id]: "member" } });
  await h.call(admin, "PUT", `/api/v1/clusters/${c1.id}/tenants/${t.id}`);
  expect((await h.call(admin, "DELETE", `/api/v1/clusters/${c1.id}/tenants/${t.id}`)).status).toBe(204);
  expect(await h.authz.check(`user:${m.id}`, "can_access", `cluster:${c1.id}`)).toBe(false);
});
