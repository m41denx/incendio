import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { enrollCluster } from "../clusters/enroll.ts";
import { FakeStores } from "./fake-cluster-store.ts";
import { reconcileCluster, type ReconcileDeps } from "./cluster.ts";
import { groupName } from "./grants.ts";

let fake: FakeIncus;
let db: Db;
let stores: FakeStores;
let deps: ReconcileDeps;
let clusterId: string;
let acme: { id: string };
let alice: string;
let bob: string;
const secretKey = Buffer.alloc(32, 2);

beforeAll(async () => {
  fake = await new FakeIncus().start();
});
afterAll(() => fake.stop());
beforeEach(async () => {
  for (const name of [...fake.projects.keys()]) if (name !== "default") fake.projects.delete(name);
  fake.config = {};
  fake.patches = [];
  db = await testDb();
  stores = new FakeStores();
  stores.autoModel = true;
  deps = { db, secretKey, openStore: stores.open, oidc: { issuer: "https://id.test/", clientId: "incus-cli", audience: "incuscloud" }, openfga: { url: "http://fga:8080", token: "k", clusterUrl: "https://fga.example", clusterToken: "ck" }, modelWaitMs: 0 };
  clusterId = (await enrollCluster({ db, secretKey }, { name: "c1", token: fake.token() })).id;
  acme = (await db.insert(tenants).values({ slug: "acme", name: "Acme", quotas: { instances: 5 } }).returning())[0]!;
  alice = (await db.insert(users).values({ email: "alice@example.com", name: "Alice" }).returning())[0]!.id;
  bob = (await db.insert(users).values({ email: "bob@example.com", name: "Bob" }).returning())[0]!.id;
  await db.insert(tenantMembers).values([{ tenantId: acme.id, userId: alice, role: "owner" }, { tenantId: acme.id, userId: bob, role: "member" }]);
  await db.insert(placements).values({ tenantId: acme.id, clusterId, project: "acme" });
});

const storeName = () => `incuscloud-cluster-${clusterId}`;
const g = (role: string) => `group:${groupName("tenant", acme.id, role)}`;

test("first pass configures the cluster, creates the project and writes grants; the second changes nothing", async () => {
  expect(await reconcileCluster(deps, clusterId)).toEqual({ status: "ready", message: "" });
  expect(fake.config).toMatchObject({ "oidc.issuer": "https://id.test/", "authorization.openfga.api.url": "https://fga.example", "authorization.openfga.api.token": "ck", "authorization.client.oidc": "openfga" });
  expect(fake.projects.get("acme")!.config["limits.instances"]).toBe("5");
  expect(stores.lines(storeName())).toContain(`user:${alice} member ${g("owner")}`);
  expect(stores.lines(storeName())).toContain(`user:${bob} member ${g("member")}`);
  expect(stores.lines(storeName())).toContain(`${g("member")}#member operator project:acme`);
  const [row] = await db.select().from(clusters).where(eq(clusters.id, clusterId));
  expect(row!.fgaStoreId).toBe([...stores.stores.keys()][0]!);
  expect(row!.reconciledAt).toBeInstanceOf(Date);
  expect((await db.select().from(placements))[0]).toMatchObject({ status: "ready", statusMessage: "" });

  const patches = fake.patches.length;
  const lines = stores.lines(storeName());
  await reconcileCluster(deps, clusterId);
  expect(fake.patches.length).toBe(patches);
  expect(stores.lines(storeName())).toEqual(lines);
});

test("removed members and disabled users lose their grants", async () => {
  await db.insert(tenantMembers).values({ tenantId: acme.id, userId: (await db.insert(users).values({ email: "c@example.com", name: "C" }).returning())[0]!.id, role: "viewer" });
  await reconcileCluster(deps, clusterId);
  await db.delete(tenantMembers).where(eq(tenantMembers.userId, bob));
  await db.update(users).set({ disabled: true }).where(eq(users.id, alice));
  await reconcileCluster(deps, clusterId);
  const lines = stores.lines(storeName()).join("\n");
  expect(lines).not.toContain(`user:${bob}`);
  expect(lines).not.toContain(`user:${alice}`);
  expect(lines).toContain(`member ${g("viewer")}`);
});

test("service accounts and platform roles are granted by their token subject", async () => {
  await db.insert(serviceAccounts).values([{ name: "ci", clientId: "sa-ci", tenantId: acme.id }, { name: "ops", clientId: "sa-ops", platformRole: "operator" }]);
  await db.insert(platformRoles).values({ userId: alice, role: "admin" });
  await reconcileCluster(deps, clusterId);
  const lines = stores.lines(storeName());
  expect(lines).toContain(`user:sa-ci member ${g("member")}`);
  expect(lines).toContain("user:sa-ops member group:incuscloud-platform-operator");
  expect(lines).toContain(`user:${alice} member group:incuscloud-platform-admin`);
});

test("unplacing a tenant removes its grants but keeps its project", async () => {
  await reconcileCluster(deps, clusterId);
  await db.delete(placements);
  await reconcileCluster(deps, clusterId);
  expect(stores.lines(storeName()).join("\n")).not.toContain(acme.id);
  expect(fake.projects.has("acme")).toBe(true);
});

test("a same-named foreign project is never granted: the placement errors and the cluster is degraded", async () => {
  fake.projects.set("acme", { config: { "user.owner": "someone" }, description: "", profiles: new Map() });
  const r = await reconcileCluster(deps, clusterId);
  expect(r.status).toBe("degraded");
  expect(r.message).toContain("acme");
  expect((await db.select().from(placements))[0]!.status).toBe("error");
  expect(stores.lines(storeName()).join("\n")).not.toContain("project:acme");
  expect(fake.projects.get("acme")!.config).toEqual({ "user.owner": "someone" });
});

test("grants wait until Incus has uploaded its model", async () => {
  stores.autoModel = false;
  const r = await reconcileCluster(deps, clusterId);
  expect(r).toMatchObject({ status: "degraded" });
  expect(r.message).toContain("model");
  expect(stores.lines(storeName())).toEqual([]);
  stores.autoModel = true;
  expect((await reconcileCluster(deps, clusterId)).status).toBe("ready");
});

test("a recreated store (OpenFGA restarted empty) is detected and refilled", async () => {
  await reconcileCluster(deps, clusterId);
  stores.stores.clear();
  await reconcileCluster(deps, clusterId);
  const [row] = await db.select().from(clusters).where(eq(clusters.id, clusterId));
  expect(fake.config["authorization.openfga.store.id"]).toBe(row!.fgaStoreId!);
  expect(stores.lines(storeName())).toContain(`user:${bob} member ${g("member")}`);
});

test("stray IncusCloud tuples are removed by the periodic full scan; foreign grants survive", async () => {
  await reconcileCluster(deps, clusterId);
  const store = await stores.open({ url: "", name: storeName() });
  await store.write([{ user: "user:mallory", relation: "member", object: g("owner") }, { user: "user:carol", relation: "admin", object: "project:acme" }], []);
  await db.update(clusters).set({ grantsScannedAt: new Date(0) }).where(eq(clusters.id, clusterId));
  await reconcileCluster(deps, clusterId);
  const lines = stores.lines(storeName());
  expect(lines.join("\n")).not.toContain("mallory");
  expect(lines).toContain("user:carol admin project:acme");
});

test("an unreachable cluster is an error and nothing else is attempted", async () => {
  await db.update(clusters).set({ url: "https://127.0.0.1:1" }).where(eq(clusters.id, clusterId));
  const r = await reconcileCluster(deps, clusterId);
  expect(r.status).toBe("error");
  expect(r.message).toContain("reach");
  expect(stores.opened.length).toBe(0);
  const [row] = await db.select().from(clusters).where(eq(clusters.id, clusterId));
  expect(row!.status).toBe("error");
});

test("a disabled cluster is left alone", async () => {
  await db.update(clusters).set({ status: "disabled" }).where(eq(clusters.id, clusterId));
  expect((await reconcileCluster(deps, clusterId)).status).toBe("disabled");
  expect(fake.patches.length).toBe(0);
  expect(stores.opened.length).toBe(0);
  expect((await db.select().from(clusters).where(eq(clusters.id, clusterId)))[0]!.status).toBe("disabled");
});
