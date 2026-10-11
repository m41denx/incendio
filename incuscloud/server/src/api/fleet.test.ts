import { beforeEach, expect, test } from "bun:test";
import { clusters, placements, serviceAccounts } from "../db/schema.ts";
import type { InstanceSnapshot, Snapshot } from "../fleet/collect.ts";
import { applySnapshot } from "../fleet/store.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let lab: string;
let edge: string;
let acme: { id: string };
let other: { id: string };

const inst = (project: string, name: string, over: Partial<InstanceSnapshot> = {}): InstanceSnapshot => ({
  project,
  name,
  type: "container",
  status: "Running",
  location: "n1",
  description: "",
  architecture: "x86_64",
  createdAt: "2026-10-01T10:00:00Z",
  imageOs: "Ubuntu",
  imageRelease: "noble",
  limitsCpu: "",
  limitsMemory: "",
  cpuNs: 1e9,
  memoryUsed: 100,
  memoryTotal: 1000,
  diskUsed: null,
  netRx: 0,
  netTx: 0,
  addresses: [],
  ...over,
});
const snap = (instances: InstanceSnapshot[], member = "n1"): Snapshot => ({
  clustered: false,
  members: [{ name: member, url: "", status: "Online", roles: [], architecture: "x86_64", cpuThreads: 8, memoryTotal: 8000, memoryUsed: 2000, load1: 0.5, uptimeS: 1 }],
  pools: [{ member, name: "local", driver: "dir", status: "Created", spaceTotal: 1000, spaceUsed: 250 }],
  networks: [],
  instances,
});
const cluster = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
const names = (body: { items: Array<{ name: string }> }) => body.items.map((i) => i.name);

beforeEach(async () => {
  h = await harness();
  lab = await cluster("lab");
  edge = await cluster("edge");
  acme = await h.tenant("acme");
  other = await h.tenant("other");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: other.id, clusterId: lab, project: "other", status: "ready" },
  ]);
  const now = new Date();
  await applySnapshot(
    h.db,
    lab,
    "lab",
    snap([
      inst("acme", "web-1", { addresses: ["10.0.0.5"], description: "Shop 100%_off" }),
      inst("acme", "db-1", { status: "Stopped", type: "virtual-machine" }),
      inst("other", "web-2"),
      inst("default", "infra"),
    ]),
    new Date(now.getTime() - 120_000),
    86_400_000,
  );
  await applySnapshot(h.db, lab, "lab", snap([inst("acme", "web-1", { cpuNs: 61e9, addresses: ["10.0.0.5"], description: "Shop 100%_off" }), inst("acme", "db-1", { status: "Stopped", type: "virtual-machine" }), inst("other", "web-2"), inst("default", "infra")]), now, 86_400_000);
  await applySnapshot(h.db, edge, "edge", snap([inst("default", "edge-1")], "e1"), now, 86_400_000);
});

test("platform viewers see every instance with its cluster and tenant", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const r = await h.call(v, "GET", "/api/v1/instances");
  expect(r.status).toBe(200);
  expect(r.body.total).toBe(5);
  expect(r.body.items.map((i: { clusterName: string; project: string; name: string; tenantSlug: string | null }) => `${i.clusterName}/${i.project}/${i.name}/${i.tenantSlug}`)).toEqual([
    "edge/default/edge-1/null",
    "lab/acme/db-1/acme",
    "lab/acme/web-1/acme",
    "lab/default/infra/null",
    "lab/other/web-2/other",
  ]);
  const web = r.body.items.find((i: { name: string }) => i.name === "web-1");
  expect(web.cpuCores).toBeCloseTo(0.5);
  expect(web.inventoryAt).toBeTruthy();
  expect(web.search).toBeUndefined();
  expect(web.cpuNs).toBeUndefined();
});

test("tenant members see only their tenants' projects, and get 404 for anything else", async () => {
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "viewer" } });
  const r = await h.call(m, "GET", "/api/v1/instances");
  expect(names(r.body)).toEqual(["db-1", "web-1"]);
  expect(r.body.total).toBe(2);
  const all = await h.call(await h.user("v@example.com", { platformRole: "viewer" }), "GET", "/api/v1/instances");
  const foreign = all.body.items.find((i: { name: string }) => i.name === "web-2");
  expect((await h.call(m, "GET", `/api/v1/instances/${foreign.id}`)).status).toBe(404);
  expect((await h.call(m, "GET", `/api/v1/instances/${foreign.id}/metrics`)).status).toBe(404);
  const mine = r.body.items.find((i: { name: string }) => i.name === "web-1");
  expect((await h.call(m, "GET", `/api/v1/instances/${mine.id}`)).body.name).toBe("web-1");
  const nobody = await h.user("n@example.com");
  expect(await h.call(nobody, "GET", "/api/v1/instances").then((x) => x.body)).toEqual({ items: [], total: 0 });
});

test("a tenant service account sees its tenant's instances", async () => {
  const [sa] = await h.db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-ci", tenantId: other.id }).returning();
  const r = await h.call({ id: sa!.id, token: await h.sign({ sub: sa!.clientId }) }, "GET", "/api/v1/instances");
  expect(names(r.body)).toEqual(["web-2"]);
});

test("search: every word must match, in any field, and % _ match literally", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const q = async (s: string) => names((await h.call(v, "GET", `/api/v1/instances?q=${encodeURIComponent(s)}`)).body);
  expect(await q("10.0.0.5")).toEqual(["web-1"]);
  expect(await q("WEB lab")).toEqual(["web-1", "web-2"]);
  expect(await q("web acme")).toEqual(["web-1"]);
  expect(await q("100%_off")).toEqual(["web-1"]);
  expect(await q("%")).toEqual(["web-1"]);
  expect(await q("_")).toEqual(["web-1"]);
});

test("filters, paging and the total", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const get = async (qs: string) => (await h.call(v, "GET", `/api/v1/instances?${qs}`)).body;
  expect(names(await get(`cluster=${edge}`))).toEqual(["edge-1"]);
  expect(names(await get(`tenant=${acme.id}`))).toEqual(["db-1", "web-1"]);
  expect(names(await get("status=Stopped"))).toEqual(["db-1"]);
  expect(names(await get("type=virtual-machine"))).toEqual(["db-1"]);
  const page = await get("limit=2&offset=2");
  expect(names(page)).toEqual(["web-1", "infra"]);
  expect(page.total).toBe(5);
  expect((await h.call(v, "GET", "/api/v1/instances?limit=501")).status).toBe(400);
});

test("instance metrics come in time order within the window", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const web = (await h.call(v, "GET", "/api/v1/instances?q=web-1")).body.items[0];
  const r = await h.call(v, "GET", `/api/v1/instances/${web.id}/metrics?hours=1`);
  expect(r.body.samples).toHaveLength(2);
  expect(r.body.samples[0].cpuCores).toBeNull();
  expect(r.body.samples[1].cpuCores).toBeCloseTo(0.5);
  expect(new Date(r.body.samples[0].at) < new Date(r.body.samples[1].at)).toBe(true);
});

test("cluster inventory, member metrics and capacity are for platform viewers", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "owner" } });
  const inv = await h.call(v, "GET", `/api/v1/clusters/${lab}/inventory`);
  expect(inv.body).toMatchObject({ inventoryError: "", instances: { total: 4, running: 3 } });
  expect(inv.body.members.map((x: { name: string }) => x.name)).toEqual(["n1"]);
  expect(inv.body.pools[0]).toMatchObject({ member: "n1", name: "local", spaceUsed: 250 });
  expect((await h.call(v, "GET", `/api/v1/clusters/${lab}/metrics`)).body.members.n1).toHaveLength(2);
  expect((await h.call(m, "GET", `/api/v1/clusters/${lab}/inventory`)).status).toBe(403);
  expect((await h.call(m, "GET", `/api/v1/clusters/${lab}/metrics`)).status).toBe(403);
  expect((await h.call(v, "GET", "/api/v1/clusters/00000000-0000-4000-8000-000000000000/inventory")).status).toBe(404);
});

test("the fleet summary counts what the caller sees; capacity only for platform viewers", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const all = (await h.call(v, "GET", "/api/v1/fleet/summary")).body;
  expect(all.instances).toEqual({ total: 5, byStatus: { Running: 4, Stopped: 1 } });
  expect(all.clusters.map((c: { name: string; instances: number; running: number; cpuThreads: number; memoryUsed: number; storageTotal: number }) => [c.name, c.instances, c.running, c.cpuThreads, c.memoryUsed, c.storageTotal])).toEqual([
    ["edge", 1, 1, 8, 2000, 1000],
    ["lab", 4, 3, 8, 2000, 1000],
  ]);
  const mine = (await h.call(m, "GET", "/api/v1/fleet/summary")).body;
  expect(mine).toEqual({ instances: { total: 2, byStatus: { Running: 1, Stopped: 1 } } });
});
