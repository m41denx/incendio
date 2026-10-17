import { beforeEach, expect, test } from "bun:test";
import { aclEntries, clusters, instances, jobs, placements } from "../db/schema.ts";
import { recordOwner } from "../acl/owners.ts";
import type { SourceInstance, TargetFacts } from "../mobility/preflight.ts";
import { harness, type Actor } from "../test/harness.ts";

// Permissions phase 2: instances, mobility and self-service create by privilege.
let h: Awaited<ReturnType<typeof harness>>;
let lab: string;
let edge: string;
let acme: { id: string };
let ids: Record<string, string>;
let u: Actor;

const source = (): SourceInstance => ({ name: "web", type: "container", status: "Running", architecture: "aarch64", config: {}, devices: {}, profiles: ["default"], expandedDevices: { root: { type: "disk", path: "/", pool: "p" } }, snapshots: 0, apiExtensions: [] });
const target = (): TargetFacts => ({ projectExists: true, architectures: ["aarch64"], pools: ["default"], networks: [], profiles: ["default"], instanceNames: [], defaultProfileDevices: {}, apiExtensions: [] });

beforeEach(async () => {
  h = await harness({ inspect: async () => ({ source: source(), target: target() }) });
  const mk = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  lab = await mk("lab");
  edge = await mk("edge");
  acme = await h.tenant("acme");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: acme.id, clusterId: edge, project: "acme-edge", status: "ready" },
  ]);
  ids = {};
  for (const [project, name] of [["acme", "mine"], ["acme", "theirs"], ["default", "infra"]] as const)
    ids[name] = (await h.db.insert(instances).values({ clusterId: lab, project, name, type: "container", status: "Running", search: name }).returning())[0]!.id;
  u = await h.user("u@x.test");
  await h.db.insert(aclEntries).values({ path: "/tenants/acme", role: "user", userId: u.id });
  await recordOwner(h.db, { clusterId: lab, project: "acme", name: "mine" }, `user:${u.id}`, "event");
});

const names = async (a: Actor) => (await h.call(a, "GET", "/api/v1/instances")).body.items.map((i: { name: string }) => i.name).sort();

test("a User sees only the instances they own: search, detail and metrics", async () => {
  expect(await names(u)).toEqual(["mine"]);
  expect((await h.call(u, "GET", `/api/v1/instances/${ids.mine}`)).status).toBe(200);
  expect((await h.call(u, "GET", `/api/v1/instances/${ids.mine}/metrics`)).status).toBe(200);
  expect((await h.call(u, "GET", `/api/v1/instances/${ids.theirs}`)).status).toBe(404);
  expect((await h.call(u, "GET", "/api/v1/fleet/summary")).body).toMatchObject({ instances: { total: 1 } });
});

test("an operator and a tenant member still see what they do today", async () => {
  const op = await h.user("op@x.test", { platformRole: "operator" });
  const m = await h.user("m@x.test", { tenants: { [acme.id]: "member" } });
  expect(await names(op)).toEqual(["infra", "mine", "theirs"]);
  expect(await names(m)).toEqual(["mine", "theirs"]);
});

test("an Auditor entry on one instance shows just that one; No access on one hides it from a member", async () => {
  const a = await h.user("a@x.test");
  await h.db.insert(aclEntries).values({ path: "/clusters/lab/projects/acme/instances/theirs", role: "auditor", userId: a.id });
  expect(await names(a)).toEqual(["theirs"]);
  const m = await h.user("m@x.test", { tenants: { [acme.id]: "member" } });
  await h.db.insert(aclEntries).values({ path: "/clusters/lab/projects/acme/instances/theirs", role: "no-access", userId: m.id });
  expect(await names(m)).toEqual(["mine"]);
  expect((await h.call(m, "GET", `/api/v1/instances/${ids.theirs}`)).status).toBe(404);
});

test("moving to another cluster: tenant admins within their placements, not Users or members; staff choose freely", async () => {
  const body = { targetClusterId: edge, mode: "copy" };
  expect((await h.call(u, "POST", `/api/v1/instances/${ids.mine}/migrations`, body)).status).toBe(403);
  const m = await h.user("m@x.test", { tenants: { [acme.id]: "member" } });
  expect((await h.call(m, "POST", `/api/v1/instances/${ids.mine}/migrations`, body)).status).toBe(403);
  const ta = await h.user("ta@x.test", { tenants: { [acme.id]: "admin" } });
  const r = await h.call(ta, "POST", `/api/v1/instances/${ids.mine}/migrations`, { ...body, targetProject: "acme-edge" });
  expect([r.status, r.body.payload?.targetProject]).toEqual([202, "acme-edge"]);
  // Operator on the instance alone does not reach the target cluster.
  const o = await h.user("o@x.test");
  await h.db.insert(aclEntries).values({ path: "/clusters/lab/projects/acme/instances/theirs", role: "operator", userId: o.id });
  expect((await h.call(o, "POST", `/api/v1/instances/${ids.theirs}/migrations`, body)).status).toBe(403);
  expect((await h.db.select().from(jobs)).length).toBe(1);
});

test("self-service create: a User is placed automatically; naming a cluster needs placement.choose", async () => {
  const body = { name: "new1", image: "debian/12", cpu: 1, memoryGiB: 1, diskGiB: 4 };
  expect((await h.call(u, "POST", `/api/v1/tenants/${acme.id}/instances`, body)).status).toBe(202);
  expect((await h.call(u, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...body, name: "new2", clusterId: edge })).status).toBe(403);
  const m = await h.user("m@x.test", { tenants: { [acme.id]: "member" } });
  expect((await h.call(m, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...body, name: "new3", clusterId: edge })).status).toBe(202);
  const stranger = await h.user("s@x.test");
  expect((await h.call(stranger, "POST", `/api/v1/tenants/${acme.id}/instances`, { ...body, name: "new4" })).status).toBe(404);
});
