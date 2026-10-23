import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, backupPolicies, backups, backupTargets, clusters, instances, jobs, placements } from "../db/schema.ts";
import { open } from "../lib/secrets.ts";
import { memoryStore } from "../backups/store.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let store: ReturnType<typeof memoryStore>;
let failCheck: string | undefined;
let lab: string;
let edge: string;
let bare: string;
let acme: { id: string };
let web: string;

const TARGET = { name: "minio", endpoint: "http://s3.example:9000", bucket: "ic-backups", prefix: "ic", accessKeyId: "AK", secretKey: "SECRET" };

beforeEach(async () => {
  store = memoryStore();
  failCheck = undefined;
  h = await harness({
    storeFor: () => ({
      ...store,
      check: async () => {
        if (failCheck) throw new Error(failCheck);
      },
    }),
  });
  const mk = async (name: string) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  lab = await mk("lab");
  edge = await mk("edge");
  bare = await mk("bare");
  acme = await h.tenant("acme");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: acme.id, clusterId: edge, project: "acme-e", status: "ready" },
  ]);
  web = (await h.db.insert(instances).values({ clusterId: lab, project: "acme", name: "web", type: "container", status: "Running", search: "web" }).returning())[0]!.id;
});

const people = async () => ({
  admin: await h.user("admin@example.com", { platformRole: "admin" }),
  op: await h.user("op@example.com", { platformRole: "operator" }),
  ta: await h.user("ta@example.com", { tenants: { [acme.id]: "admin" } }),
  // A member is an unrestricted user on the tenant: every workload privilege. A viewer reads only.
  m: await h.user("m@example.com", { tenants: { [acme.id]: "member" } }),
  v: await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } }),
  out: await h.user("out@example.com", {}),
});
const mkTarget = async (admin: Parameters<typeof h.call>[0]) => (await h.call(admin, "POST", "/api/v1/backup-targets", TARGET)).body.id as string;

test("targets: admins manage them; the secret is sealed and never returned; others see names only", async () => {
  const { admin, op, m } = await people();
  expect((await h.call(op, "POST", "/api/v1/backup-targets", TARGET)).status).toBe(403);
  const r = await h.call(admin, "POST", "/api/v1/backup-targets", TARGET);
  expect(r.status).toBe(201);
  expect(r.body).toEqual({ id: expect.any(String), name: "minio", endpoint: TARGET.endpoint, region: "", bucket: "ic-backups", prefix: "ic", accessKeyId: "AK", enabled: true, createdAt: expect.any(String) });
  const [row] = await h.db.select().from(backupTargets);
  expect(row!.secretKeyEnc).not.toContain("SECRET");
  expect(open(Buffer.alloc(32, 8), row!.secretKeyEnc)).toBe("SECRET");
  expect((await h.call(op, "GET", "/api/v1/backup-targets")).body[0]).toMatchObject({ endpoint: TARGET.endpoint, bucket: "ic-backups" });
  expect(JSON.stringify((await h.call(op, "GET", "/api/v1/backup-targets")).body)).not.toContain("secret");
  expect((await h.call(m, "GET", "/api/v1/backup-targets")).body).toEqual([{ id: r.body.id, name: "minio" }]);
  expect((await h.call(admin, "POST", "/api/v1/backup-targets", TARGET)).status).toBe(409);
  expect((await h.call(admin, "POST", "/api/v1/backup-targets", { ...TARGET, name: "bad", endpoint: "ftp://x" })).status).toBe(400);

  expect((await h.call(admin, "PATCH", `/api/v1/backup-targets/${r.body.id}`, { secretKey: "NEW", enabled: false })).body).toMatchObject({ enabled: false });
  expect(open(Buffer.alloc(32, 8), (await h.db.select().from(backupTargets))[0]!.secretKeyEnc)).toBe("NEW");
  expect((await h.call(m, "GET", "/api/v1/backup-targets")).body).toEqual([]);
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "backup_target.update"))).length).toBe(1);
});

test("targets: check reports the store's answer; a target in use cannot be deleted", async () => {
  const { admin, ta } = await people();
  const id = await mkTarget(admin);
  expect((await h.call(admin, "POST", `/api/v1/backup-targets/${id}/check`)).body).toEqual({ ok: true });
  failCheck = "Target: InvalidAccessKeyId";
  expect((await h.call(admin, "POST", `/api/v1/backup-targets/${id}/check`)).body).toEqual({ ok: false, error: "Target: InvalidAccessKeyId" });
  await h.call(ta, "POST", "/api/v1/backup-policies", { instanceId: web, targetId: id });
  expect((await h.call(admin, "DELETE", `/api/v1/backup-targets/${id}`)).status).toBe(409);
  await h.db.delete(backupPolicies);
  expect((await h.call(admin, "DELETE", `/api/v1/backup-targets/${id}`)).status).toBe(204);
});

test("back up now: tenant admins, members and operators; viewers are refused; outsiders do not see the instance", async () => {
  const { admin, op, ta, m, v, out } = await people();
  const targetId = await mkTarget(admin);
  const r = await h.call(ta, "POST", `/api/v1/instances/${web}/backups`, { targetId });
  expect(r.status).toBe(202);
  expect(r.body).toMatchObject({ type: "backup", tenantId: acme.id, instanceKey: `${lab}/acme/web`, payload: { clusterId: lab, project: "acme", instanceName: "web", targetId, instanceOnly: false, transport: "auto" } });
  expect((await h.call(ta, "POST", `/api/v1/instances/${web}/backups`, { targetId })).status).toBe(409);
  await h.db.update(jobs).set({ state: "succeeded" });
  expect((await h.call(v, "POST", `/api/v1/instances/${web}/backups`, { targetId })).status).toBe(403);
  expect((await h.call(m, "POST", `/api/v1/instances/${web}/backups`, { targetId })).status).toBe(202);
  await h.db.update(jobs).set({ state: "succeeded" });
  expect((await h.call(out, "POST", `/api/v1/instances/${web}/backups`, { targetId })).status).toBe(404);
  expect((await h.call(ta, "POST", `/api/v1/instances/${web}/backups`, { targetId, transport: "relay" })).status).toBe(403);
  expect((await h.call(op, "POST", `/api/v1/instances/${web}/backups`, { targetId, transport: "relay", instanceOnly: true })).body.payload).toMatchObject({ transport: "relay", instanceOnly: true });
  await h.db.update(jobs).set({ state: "succeeded" });
  await h.db.update(backupTargets).set({ enabled: false });
  expect((await h.call(ta, "POST", `/api/v1/instances/${web}/backups`, { targetId })).status).toBe(409);
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "backup.create"))).length).toBeGreaterThan(0);
});

test("backups: tenant members and viewers list them; admins delete them, object first; a backup in progress stays", async () => {
  const { admin, ta, m, v, out } = await people();
  const targetId = await mkTarget(admin);
  await store.put("ic/acme/web/1.tar.gz", new Blob(["x"]).stream());
  const [b] = await h.db.insert(backups).values({ tenantId: acme.id, targetId, objectKey: "ic/acme/web/1.tar.gz", clusterId: lab, project: "acme", instanceName: "web", state: "ready", sizeBytes: 1, createdBy: "u" }).returning();
  const [c] = await h.db.insert(backups).values({ tenantId: acme.id, targetId, objectKey: "ic/acme/web/2.tar.gz", clusterId: lab, project: "acme", instanceName: "web", state: "creating", createdBy: "u" }).returning();
  const list = (await h.call(m, "GET", "/api/v1/backups")).body;
  expect(list.map((x: { id: string }) => x.id).sort()).toEqual([b!.id, c!.id].sort());
  expect(list.find((x: { id: string }) => x.id === b!.id)).toMatchObject({ targetName: "minio", clusterName: "lab", tenantId: acme.id });
  expect((await h.call(m, "GET", `/api/v1/backups?instance=${web}`)).body.length).toBe(2);
  expect((await h.call(out, "GET", "/api/v1/backups")).body).toEqual([]);
  expect((await h.call(out, "GET", `/api/v1/backups/${b!.id}`)).status).toBe(404);
  expect((await h.call(v, "GET", "/api/v1/backups")).body.length).toBe(2);
  expect((await h.call(v, "DELETE", `/api/v1/backups/${b!.id}`)).status).toBe(403);
  expect((await h.call(ta, "DELETE", `/api/v1/backups/${c!.id}`)).status).toBe(409);
  expect((await h.call(ta, "DELETE", `/api/v1/backups/${b!.id}`)).status).toBe(204);
  expect(store.keys()).toEqual([]);
  expect((await h.db.select().from(backups)).map((x) => x.id)).toEqual([c!.id]);
});

test("restore: tenant admins to their placements' projects (same cluster too); operators anywhere, with a pool", async () => {
  const { admin, op, ta, v } = await people();
  const targetId = await mkTarget(admin);
  const [b] = await h.db.insert(backups).values({ tenantId: acme.id, targetId, objectKey: "k", clusterId: lab, project: "acme", instanceName: "web", state: "ready", createdBy: "u" }).returning();
  const url = `/api/v1/backups/${b!.id}/restore`;
  const same = await h.call(ta, "POST", url, { targetClusterId: lab, targetName: "web-restored" });
  expect(same.status).toBe(202);
  expect(same.body).toMatchObject({ type: "restore", tenantId: acme.id, payload: { backupId: b!.id, targetClusterId: lab, targetProject: "acme", targetName: "web-restored", start: false } });
  expect((await h.call(ta, "POST", url, { targetClusterId: edge, start: true })).body.payload).toMatchObject({ targetProject: "acme-e", targetName: "web", start: true });
  expect((await h.call(ta, "POST", url, { targetClusterId: bare })).status).toBe(403);
  expect((await h.call(ta, "POST", url, { targetClusterId: edge, pool: "fast" })).status).toBe(403);
  expect((await h.call(ta, "POST", url, { targetClusterId: edge, targetProject: "other" })).status).toBe(403);
  expect((await h.call(v, "POST", url, { targetClusterId: lab })).status).toBe(403);
  expect((await h.call(op, "POST", url, { targetClusterId: bare, targetProject: "rescue", pool: "fast" })).body.payload).toMatchObject({ targetClusterId: bare, targetProject: "rescue", pool: "fast" });
  await h.db.update(backups).set({ state: "failed" });
  expect((await h.call(ta, "POST", url, { targetClusterId: lab })).status).toBe(409);
  expect((await h.db.select().from(auditLog).where(eq(auditLog.action, "backup.restore"))).length).toBeGreaterThan(0);
});

test("policies: tenant admins create, edit, run and delete; viewers read only; the backups outlive the policy", async () => {
  const { admin, ta, v, out } = await people();
  const targetId = await mkTarget(admin);
  const r = await h.call(ta, "POST", "/api/v1/backup-policies", { instanceId: web, targetId, intervalS: 3600, keep: 3 });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ tenantId: acme.id, clusterId: lab, project: "acme", instanceName: "web", targetId, intervalS: 3600, keep: 3, enabled: true });
  expect((await h.call(ta, "POST", "/api/v1/backup-policies", { instanceId: web, targetId })).status).toBe(409);
  expect((await h.call(ta, "POST", "/api/v1/backup-policies", { instanceId: web, targetId, keep: 0 })).status).toBe(400);
  expect((await h.call(v, "POST", "/api/v1/backup-policies", { instanceId: web, targetId })).status).toBe(403);
  expect((await h.call(v, "GET", "/api/v1/backup-policies")).body.map((p: { id: string }) => p.id)).toEqual([r.body.id]);
  expect((await h.call(out, "GET", "/api/v1/backup-policies")).body).toEqual([]);
  const id = r.body.id;
  expect((await h.call(v, "PATCH", `/api/v1/backup-policies/${id}`, { enabled: false })).status).toBe(403);
  expect((await h.call(ta, "PATCH", `/api/v1/backup-policies/${id}`, { enabled: false, keep: 5 })).body).toMatchObject({ enabled: false, keep: 5 });
  const run = await h.call(ta, "POST", `/api/v1/backup-policies/${id}/run`);
  expect(run.status).toBe(202);
  expect(run.body.payload).toMatchObject({ policyId: id, transport: "auto" });
  expect((await h.call(ta, "POST", `/api/v1/backup-policies/${id}/run`)).status).toBe(409);
  await h.db.insert(backups).values({ tenantId: acme.id, policyId: id, targetId, objectKey: "k", project: "acme", instanceName: "web", state: "ready", createdBy: "u" });
  expect((await h.call(ta, "DELETE", `/api/v1/backup-policies/${id}`)).status).toBe(204);
  expect((await h.db.select().from(backups))[0]!.policyId).toBeNull();
});
