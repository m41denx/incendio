import { beforeEach, expect, test } from "bun:test";
import { aclEntries, auditLog, clusters, instances, k8sClusters, placements } from "../db/schema.ts";
import { onLifecycle } from "../acl/lifecycle.ts";
import { deleteK8sRow } from "../k8s/jobs.ts";
import { harness, type Actor } from "../test/harness.ts";
import { seal } from "../lib/secrets.ts";

let h: Awaited<ReturnType<typeof harness>>;
let admin: Actor;
let c: string;

beforeEach(async () => {
  h = await harness();
  admin = await h.user("root@x.test", { platformRole: "admin" });
  c = await mkCluster("c");
});

// Unreachable: deleting it only logs that its settings could not be unset.
const mkCluster = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://127.0.0.1:9", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: seal(h.deps.secretKey, "key"), status: "ready" }).returning())[0]!.id;
const add = (a: Actor, path: string, subject: Actor, role: string, propagate = true) => h.call(a, "POST", "/api/v1/acl/entries", { path, subject: { type: "user", id: subject.id }, role, propagate });
const explicit = () => h.db.select().from(aclEntries);

test("roles are listed for anyone signed in", async () => {
  const u = await h.user("u@x.test");
  const r = await h.call(u, "GET", "/api/v1/acl/roles");
  expect(r.status).toBe(200);
  expect(r.body.find((x: { id: string }) => x.id === "auditor")).toMatchObject({ name: "Auditor" });
  expect(r.body.find((x: { id: string }) => x.id === "no-access").privileges).toEqual([]);
});

test("admins add and remove an operator entry on a cluster; it is audited and the user can then reconcile it", async () => {
  const u = await h.user("u@x.test");
  expect((await h.call(u, "POST", `/api/v1/clusters/${c}/reconcile`)).status).toBe(404);
  const r = await add(admin, "/clusters/c", u, "operator");
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ path: "/clusters/c", role: "operator", propagate: true, source: "acl", editable: true, subject: { type: "user", id: u.id, name: "u@x.test" } });
  expect((await h.call(u, "POST", `/api/v1/clusters/${c}/reconcile`)).status).toBe(202);
  expect((await add(admin, "/clusters/c", u, "operator")).status).toBe(409);
  expect((await h.call(admin, "DELETE", `/api/v1/acl/entries/${r.body.id}`)).status).toBe(204);
  expect((await h.call(u, "POST", `/api/v1/clusters/${c}/reconcile`)).status).toBe(404);
  const actions = (await h.db.select().from(auditLog)).map((a) => [a.action, a.result]);
  expect(actions).toEqual(expect.arrayContaining([["acl.entry.create", "success"], ["acl.entry.delete", "success"]]));
});

test("entries list explicit and virtual entries, virtual ones read-only and pointing at their page", async () => {
  const u = await h.user("u@x.test");
  await add(admin, "/clusters/c", u, "auditor");
  const r = await h.call(admin, "GET", "/api/v1/acl/entries");
  expect(r.status).toBe(200);
  expect(r.body.find((e: any) => e.subject.id === admin.id)).toMatchObject({ path: "/", role: "administrator", source: "platform-role", editable: false, editedOn: "users" });
  expect(r.body.find((e: any) => e.subject.id === u.id)).toMatchObject({ path: "/clusters/c", role: "auditor", editable: true });
  expect((await h.call(admin, "GET", "/api/v1/acl/entries?path=/clusters/c")).body.map((e: any) => e.path)).toEqual(["/clusters/c"]);
});

test("tenant admins manage entries on their tenant only", async () => {
  const acme = await h.tenant("acme");
  await h.tenant("beta");
  const ta = await h.user("ta@x.test", { tenants: { [acme.id]: "admin" } });
  const u = await h.user("u@x.test");
  const r = await add(ta, "/tenants/acme", u, "auditor");
  expect(r.status).toBe(201);
  expect((await add(ta, "/tenants/beta", u, "auditor")).status).toBe(404);
  expect((await add(ta, "/clusters/c", u, "auditor")).status).toBe(404);
  expect((await add(ta, "/", u, "auditor")).status).toBe(403);
  const seen = (await h.call(ta, "GET", "/api/v1/acl/entries")).body.map((e: any) => e.path);
  expect(new Set(seen)).toEqual(new Set(["/tenants/acme"]));
});

test("auditors read, never write", async () => {
  const a = await h.user("a@x.test", { platformRole: "viewer" });
  const u = await h.user("u@x.test");
  expect((await h.call(a, "GET", "/api/v1/acl/entries")).status).toBe(200);
  expect((await add(a, "/clusters/c", u, "auditor")).status).toBe(403);
  const e = await add(admin, "/clusters/c", u, "auditor");
  expect((await h.call(a, "DELETE", `/api/v1/acl/entries/${e.body.id}`)).status).toBe(403);
});

test("Group owner and unknown roles, group paths and paths naming nothing are refused", async () => {
  const u = await h.user("u@x.test");
  for (const role of ["group-owner", "nope"]) expect((await add(admin, "/clusters/c", u, role)).status).toBe(400);
  for (const path of ["/clusters/c/projects/p", "/clusters/c/projects/p/instances/i", "/clusters/c/groups/g", "/tenants/x/kubernetes/k", "/clusters/missing", "/tenants/missing", "bad"])
    expect([path, (await add(admin, path, u, "auditor")).status]).toEqual([path, 400]);
  expect((await h.call(admin, "POST", "/api/v1/acl/entries", { path: "/", subject: { type: "user", id: crypto.randomUUID() }, role: "auditor", propagate: true })).status).toBe(400);
  expect(await explicit()).toEqual([]);
});

test("only administrators grant administrator or cluster owner", async () => {
  const owner = await h.user("o@x.test");
  const u = await h.user("u@x.test");
  await add(admin, "/clusters/c", owner, "cluster-owner");
  expect((await add(owner, "/clusters/c", u, "operator")).status).toBe(201);
  expect((await add(owner, "/clusters/c", u, "cluster-owner")).status).toBe(403);
  expect((await add(owner, "/clusters/c", u, "administrator")).status).toBe(403);
  expect((await add(admin, "/clusters/c", u, "cluster-owner")).status).toBe(201);
});

test("the last administrator cannot lose administrator through an entry", async () => {
  const b = await h.user("b@x.test");
  const e = await add(admin, "/", b, "administrator");
  expect(e.status).toBe(201);
  // b now counts as an administrator: the platform role may go.
  expect((await h.call(admin, "PATCH", `/api/v1/users/${admin.id}`, { platformRole: null })).status).toBe(200);
  const r = await h.call(b, "DELETE", `/api/v1/acl/entries/${e.body.id}`);
  expect([r.status, r.body.error.code]).toEqual([409, "last_admin"]);
  expect((await h.call(b, "DELETE", `/api/v1/users/${b.id}`)).status).toBe(409);
  // No access on / would take it too.
  expect((await add(b, "/", b, "no-access")).status).toBe(409);
});

test("deleting a cluster deletes its entries, and a new cluster of the same name starts with none", async () => {
  const u = await h.user("u@x.test");
  expect((await add(admin, "/clusters/c", u, "operator")).status).toBe(201);
  const del = await h.call(admin, "DELETE", `/api/v1/clusters/${c}`);
  expect([del.status, del.body]).toEqual([204, null]);
  expect(await explicit()).toEqual([]);
  const again = await mkCluster("c");
  expect((await h.call(u, "GET", `/api/v1/clusters/${again}`)).status).toBe(404);
});

test("deleting a tenant deletes its entries", async () => {
  const acme = await h.tenant("acme");
  const u = await h.user("u@x.test");
  expect((await add(admin, "/tenants/acme", u, "auditor")).status).toBe(201);
  expect((await h.call(admin, "DELETE", `/api/v1/tenants/${acme.id}`)).status).toBe(204);
  expect(await explicit()).toEqual([]);
});

test("deleting a user deletes their entries", async () => {
  const u = await h.user("u@x.test");
  expect((await add(admin, "/clusters/c", u, "operator")).status).toBe(201);
  expect((await h.call(admin, "DELETE", `/api/v1/users/${u.id}`)).status).toBe(204);
  expect(await explicit()).toEqual([]);
});

test("check explains the deciding entries", async () => {
  const acme = await h.tenant("acme");
  const u = await h.user("u@x.test", { tenants: { [acme.id]: "member" } });
  await add(admin, "/tenants/acme", u, "no-access");
  const r = await h.call(admin, "GET", `/api/v1/acl/check?subject=user:${u.id}&path=/tenants/acme`);
  expect(r.status).toBe(200);
  expect(r.body.privileges).toEqual([]);
  expect(r.body.decidedBy.map((e: any) => [e.role, e.source]).sort()).toEqual([["no-access", "acl"], ["unrestricted-user", "tenant-membership"]]);
  const outsider = await h.user("o@x.test");
  expect((await h.call(outsider, "GET", `/api/v1/acl/check?subject=user:${u.id}&path=/`)).status).toBe(404);
});

test("/me carries the caller's privileges on /", async () => {
  const u = await h.user("u@x.test");
  expect((await h.call(u, "GET", "/api/v1/me")).body.rootPrivileges).toEqual([]);
  const r = (await h.call(admin, "GET", "/api/v1/me")).body.rootPrivileges;
  expect(r).toContain("acl.manage");
  expect(r).toContain("platform.users");
});

// Final review fixes.
test("a tenant admin cannot narrow platform staff or the tenant's owner, only people below them", async () => {
  const acme = await h.tenant("acme");
  const owner = await h.user("own@x.test", { tenants: { [acme.id]: "owner" } });
  const ta = await h.user("ta@x.test", { tenants: { [acme.id]: "admin" } });
  const member = await h.user("m@x.test", { tenants: { [acme.id]: "member" } });
  const op = await h.user("op@x.test", { platformRole: "operator" });
  for (const victim of [admin, op, owner]) expect([victim.id, (await add(ta, "/tenants/acme", victim, "no-access")).status]).toEqual([victim.id, 403]);
  expect((await add(ta, "/tenants/acme", member, "auditor")).status).toBe(201);
  // An owner may, and so may administrators.
  expect((await add(owner, "/tenants/acme", ta, "auditor")).status).toBe(201);
});

test("a tenant admin cannot remove an entry made by someone above them", async () => {
  const acme = await h.tenant("acme");
  const ta = await h.user("ta@x.test", { tenants: { [acme.id]: "admin" } });
  const member = await h.user("m@x.test", { tenants: { [acme.id]: "member" } });
  const e = await add(admin, "/tenants/acme", member, "no-access");
  expect((await h.call(ta, "DELETE", `/api/v1/acl/entries/${e.body.id}`)).status).toBe(403);
  const own = await add(ta, "/tenants/acme", member, "auditor");
  expect((await h.call(ta, "DELETE", `/api/v1/acl/entries/${own.body.id}`)).status).toBe(204);
});

test("Unrestricted user goes on tenants only for now, and /platform takes no entries", async () => {
  const u = await h.user("u@x.test");
  await h.tenant("acme");
  for (const path of ["/", "/clusters/c"]) expect([path, (await add(admin, path, u, "unrestricted-user")).status]).toEqual([path, 400]);
  expect((await add(admin, "/tenants/acme", u, "unrestricted-user")).status).toBe(201);
  expect((await add(admin, "/platform", u, "auditor")).status).toBe(400);
});

test("No access on / makes an administrator no longer count: the last effective one cannot step down", async () => {
  const b = await h.user("b@x.test", { platformRole: "admin" });
  expect((await add(admin, "/", b, "no-access")).status).toBe(201);
  const r = await h.call(admin, "PATCH", `/api/v1/users/${admin.id}`, { platformRole: "operator" });
  expect([r.status, r.body.error?.code]).toEqual([409, "last_admin"]);
});

// Permissions phase 2: project, instance and Kubernetes paths; the User role.
const instance = (name: string, project = "acme") => h.db.insert(instances).values({ clusterId: c, project, name, type: "container", status: "Running", search: name });

test("a tenant admin gives User on their tenant and Operator on one of its instances", async () => {
  const acme = await h.tenant("acme");
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: c, project: "acme" });
  await instance("web");
  const ta = await h.user("ta@x.test", { tenants: { [acme.id]: "admin" } });
  const u = await h.user("u@x.test");
  expect((await add(ta, "/tenants/acme", u, "user")).status).toBe(201);
  expect((await add(ta, "/clusters/c/projects/acme/instances/web", u, "operator")).status).toBe(201);
  expect((await add(ta, "/clusters/c/projects/acme", u, "auditor")).status).toBe(201);
  // Not their project.
  await instance("other", "default");
  expect((await add(ta, "/clusters/c/projects/default/instances/other", u, "operator")).status).toBe(404);
});

test("project, instance and Kubernetes paths must exist", async () => {
  const acme = await h.tenant("acme");
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: c, project: "acme" });
  const u = await h.user("u@x.test");
  expect((await add(admin, "/clusters/c/projects/acme", u, "auditor")).status).toBe(201);
  for (const path of ["/clusters/c/projects/nope", "/clusters/c/projects/acme/instances/nope", "/tenants/acme/kubernetes/nope"]) expect([path, (await add(admin, path, u, "auditor")).status]).toEqual([path, 400]);
});

test("group paths and Group owner are still refused", async () => {
  const u = await h.user("u@x.test");
  expect((await add(admin, "/clusters/c/groups/gpu", u, "auditor")).status).toBe(400);
  await h.tenant("acme");
  expect((await add(admin, "/tenants/acme", u, "group-owner")).status).toBe(400);
});

test("deleting a Kubernetes cluster's row deletes its entries; a deleted instance's entries go with its delete event", async () => {
  const acme = await h.tenant("acme");
  const u = await h.user("u@x.test");
  const [k] = await h.db
    .insert(k8sClusters)
    .values({ tenantId: acme.id, clusterId: c, name: "k1", namespace: "ic-acme", version: "v1.31.0", controlPlanes: 1, workers: 1, spec: {} as never, endpointHost: "10.0.0.1", endpointPort: 16443, createdBy: `user:${admin.id}` })
    .returning();
  expect((await add(admin, "/tenants/acme/kubernetes/k1", u, "auditor")).status).toBe(201);
  await deleteK8sRow(h.db, k!.id);
  expect(await h.db.select().from(aclEntries)).toEqual([]);
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: c, project: "acme" });
  await instance("web");
  expect((await add(admin, "/clusters/c/projects/acme/instances/web", u, "auditor")).status).toBe(201);
  await onLifecycle(h.db, c, { type: "lifecycle", metadata: { action: "instance-deleted", name: "web", project: "acme" } });
  expect(await h.db.select().from(aclEntries)).toEqual([]);
});

test("a rename moves the instance's entries", async () => {
  const acme = await h.tenant("acme");
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: c, project: "acme" });
  await instance("web");
  const u = await h.user("u@x.test");
  await add(admin, "/clusters/c/projects/acme/instances/web", u, "auditor");
  await onLifecycle(h.db, c, { type: "lifecycle", metadata: { action: "instance-renamed", name: "web2", project: "acme", context: { old_name: "web" } } });
  expect((await h.db.select().from(aclEntries)).map((e) => e.path)).toEqual(["/clusters/c/projects/acme/instances/web2"]);
});

test("an entry on an instance makes its cluster visible to the subject", async () => {
  const acme = await h.tenant("acme");
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: c, project: "acme" });
  await instance("web");
  const u = await h.user("u@x.test");
  expect((await h.call(u, "GET", `/api/v1/clusters/${c}`)).status).toBe(404);
  await add(admin, "/clusters/c/projects/acme/instances/web", u, "auditor");
  expect((await h.call(u, "GET", `/api/v1/clusters/${c}`)).status).toBe(200);
});
