import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { aclEntries, clusters, instances, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import { recordOwner } from "../acl/owners.ts";
import type { Db } from "../db/index.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { enrollCluster } from "../clusters/enroll.ts";
import { FakeStores } from "./fake-cluster-store.ts";
import { reconcileCluster, type ReconcileDeps } from "./cluster.ts";
import { aclGroup, groupName } from "./grants.ts";

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

const GiB = 1024 ** 3;
/** A second cluster where the tenant already uses something (as its own reconcile recorded). */
async function elsewhere(usage: { instances: number; cpu: number; memory: number; disk: number }) {
  const [c2] = await db.insert(clusters).values({ name: "c2", url: "https://c2:8443", fingerprint: "ff", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning();
  await db.insert(placements).values({ tenantId: acme.id, clusterId: c2!.id, project: "acme", status: "ready", usage });
}

test("the project gets its share of the tenant's quota: its usage plus what the tenant has left across clusters", async () => {
  await db.update(tenants).set({ quotas: { instances: 5, memory: 8 } }).where(eq(tenants.id, acme.id));
  await elsewhere({ instances: 2, cpu: 2, memory: 2 * GiB, disk: 0 });
  // First pass: the project is new and uses nothing.
  await reconcileCluster(deps, clusterId);
  expect(fake.projects.get("acme")!.config).toMatchObject({ "limits.instances": "3", "limits.memory": String(6 * GiB) });
  // It grows; the next pass records that and shares what is left.
  fake.projects.get("acme")!.usage = { instances: 1, cpu: 1, memory: GiB, disk: 0 };
  expect(await reconcileCluster(deps, clusterId)).toEqual({ status: "ready", message: "" });
  expect(fake.projects.get("acme")!.config).toMatchObject({ "limits.instances": "3", "limits.memory": String(6 * GiB) });
  const row = (await db.select().from(placements).where(eq(placements.clusterId, clusterId)))[0]!;
  expect(row.usage).toEqual({ instances: 1, cpu: 1, memory: GiB, disk: 0 });
  expect(row.limits).toEqual({ instances: 3, memory: 6 * GiB });
});

test("a quota lowered below usage leaves limits at usage: nothing new, nothing refused", async () => {
  await reconcileCluster(deps, clusterId);
  fake.projects.get("acme")!.usage = { instances: 4, cpu: 0, memory: 0, disk: 0 };
  await db.update(tenants).set({ quotas: { instances: 2 } }).where(eq(tenants.id, acme.id));
  expect(await reconcileCluster(deps, clusterId)).toEqual({ status: "ready", message: "" });
  expect(fake.projects.get("acme")!.config["limits.instances"]).toBe("4");
});

test("a quota removed unsets its limit", async () => {
  await reconcileCluster(deps, clusterId);
  await db.update(tenants).set({ quotas: {} }).where(eq(tenants.id, acme.id));
  await reconcileCluster(deps, clusterId);
  expect(fake.projects.get("acme")!.config["limits.instances"]).toBeUndefined();
});

describe("explicit permission entries", () => {
  const carol = async () => (await db.insert(users).values({ email: "carol@example.com", name: "Carol" }).returning())[0]!.id;
  const entry = (userId: string, path: string, role: string) => db.insert(aclEntries).values({ path, role, userId });
  const acl = (relation: string, object: string) => `group:${aclGroup(relation, object)}`;

  test("today's roles alone write no permission groups", async () => {
    await reconcileCluster(deps, clusterId);
    expect(stores.lines(storeName()).filter((l) => l.includes("incuscloud-acl-"))).toEqual([]);
  });

  test("an operator entry on /clusters/c1 gives server operator there, through an incuscloud-acl group", async () => {
    const c = await carol();
    await entry(c, "/clusters/c1", "operator");
    await reconcileCluster(deps, clusterId);
    expect(stores.lines(storeName())).toEqual(expect.arrayContaining([`user:${c} member ${acl("operator", "server:incus")}`, `${acl("operator", "server:incus")}#member operator server:incus`]));
    // An entry on another cluster gives nothing here.
    await db.delete(aclEntries);
    await entry(c, "/clusters/other", "operator");
    await reconcileCluster(deps, clusterId);
    expect(stores.lines(storeName()).filter((l) => l.startsWith(`user:${c} `))).toEqual([]);
  });

  test("an auditor entry on /tenants/acme gives project viewer on acme's project", async () => {
    const c = await carol();
    await entry(c, "/tenants/acme", "auditor");
    await reconcileCluster(deps, clusterId);
    expect(stores.lines(storeName()).filter((l) => l.startsWith(`user:${c} `))).toEqual([`user:${c} member ${acl("viewer", "project:acme")}`]);
    expect(stores.lines(storeName())).toContain(`${acl("viewer", "project:acme")}#member viewer project:acme`);
  });

  test("a platform operator with no-access on /tenants/acme gets operator on every other project, and no server relation", async () => {
    const dave = (await db.insert(users).values({ email: "dave@example.com", name: "Dave" }).returning())[0]!.id;
    await db.insert(platformRoles).values({ userId: dave, role: "operator" });
    await entry(dave, "/tenants/acme", "no-access");
    await reconcileCluster(deps, clusterId);
    expect(stores.lines(storeName()).filter((l) => l.startsWith(`user:${dave} `))).toEqual([`user:${dave} member ${acl("operator", "project:default")}`]);
  });

  test("a tenant member's own entry on the cluster replaces its tenant group there, keeping its project rights", async () => {
    await entry(bob, "/clusters/c1", "auditor");
    await reconcileCluster(deps, clusterId);
    expect(stores.lines(storeName()).filter((l) => l.startsWith(`user:${bob} `)).sort()).toEqual([`user:${bob} member ${acl("operator", "project:acme")}`, `user:${bob} member ${acl("viewer", "server:incus")}`].sort());
  });
});

describe("User entries (permissions phase 2)", () => {
  const acl = (relation: string, object: string) => `group:${aclGroup(relation, object)}`;
  test("a User on /tenants/acme: the project's direct entitlements, can_view on its shared objects, operator on what they own — never a project relation", async () => {
    await reconcileCluster(deps, clusterId);
    const u = (await db.insert(users).values({ email: "u@example.com", name: "U" }).returning())[0]!.id;
    await db.insert(aclEntries).values({ path: "/tenants/acme", role: "user", userId: u });
    await db.insert(instances).values([
      { clusterId, project: "acme", name: "mine", type: "container", status: "Running", search: "mine" },
      { clusterId, project: "acme", name: "theirs", type: "container", status: "Running", search: "theirs" },
    ]);
    await recordOwner(db, { clusterId, project: "acme", name: "mine" }, `user:${u}`, "event");
    fake.images.set("acme", ["abc"]);
    await reconcileCluster(deps, clusterId);
    const mine = stores.lines(storeName()).filter((l) => l.startsWith(`user:${u} `)).map((l) => l.split(" member ")[1]).sort();
    expect(mine).toEqual(
      [
        ...["can_create_instances", "can_create_storage_volumes", "can_create_storage_buckets", "can_view_events", "can_view_operations"].map((r) => acl(r, "project:acme")),
        acl("can_view", "profile:acme/default"),
        acl("can_view", "network:default/incusbr0"),
        acl("can_view", "image:acme/abc"),
        acl("operator", "instance:acme/mine"),
      ].sort(),
    );
    // A User entry makes the subject explicit: no tenant group for them.
    expect(stores.lines(storeName()).some((l) => l.startsWith(`user:${u} member group:incuscloud-tenant-`))).toBe(false);
  });
});
