import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, clusters, instances, jobs, placements } from "../db/schema.ts";
import type { SourceInstance, TargetFacts } from "../mobility/preflight.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let lab: string;
let edge: string;
let far: string;
let acme: { id: string };
let tenantInstance: string;
let infraInstance: string;
let targetOver: Partial<TargetFacts>;
const seen: Array<{ dst: string; targetProject: string }> = [];

const source = (): SourceInstance => ({ name: "web", type: "container", status: "Running", architecture: "aarch64", config: {}, devices: {}, profiles: ["default"], expandedDevices: { root: { type: "disk", path: "/", pool: "p" } }, snapshots: 0, apiExtensions: [] });
const target = (): TargetFacts => ({ projectExists: true, architectures: ["aarch64"], pools: ["default"], networks: [], profiles: ["default"], instanceNames: [], defaultProfileDevices: {}, apiExtensions: [], ...targetOver });

beforeEach(async () => {
  targetOver = {};
  seen.length = 0;
  h = await harness({
    inspect: async (_src, dst, _project, _name, targetProject) => {
      seen.push({ dst: dst.name, targetProject });
      return { source: source(), target: target() };
    },
  });
  const mk = async (name: string, status = "ready") => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status }).returning())[0]!.id;
  lab = await mk("lab");
  edge = await mk("edge");
  far = await mk("far");
  acme = await h.tenant("acme");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: acme.id, clusterId: edge, project: "acme-edge", status: "ready" },
  ]);
  const inst = async (clusterId: string, project: string, name: string) => (await h.db.insert(instances).values({ clusterId, project, name, type: "container", status: "Running", search: name }).returning())[0]!.id;
  tenantInstance = await inst(lab, "acme", "web");
  infraInstance = await inst(lab, "default", "infra");
});

const post = (who: Parameters<typeof h.call>[0], id: string, body: Record<string, unknown>, check = false) => h.call(who, "POST", `/api/v1/instances/${id}/migrations${check ? "/preflight" : ""}`, body);

test("platform operators check and start a migration; the target project follows the tenant's placement", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  const check = await post(op, tenantInstance, { targetClusterId: edge, mode: "move" }, true);
  expect(check.status).toBe(200);
  expect(check.body).toEqual({ ok: true, problems: [], warnings: ["The container is stopped for the move and started again on the target"], targetProject: "acme-edge", targetName: "web" });
  const r = await post(op, tenantInstance, { targetClusterId: edge, mode: "move", transport: "relay" });
  expect(r.status).toBe(202);
  expect(r.body).toMatchObject({ type: "migrate", state: "queued", tenantId: acme.id, instanceKey: `${lab}/acme/web` });
  expect(r.body.payload).toEqual({ sourceClusterId: lab, sourceProject: "acme", name: "web", targetClusterId: edge, targetProject: "acme-edge", targetName: "web", mode: "move", live: false, transport: "relay" });
  const [a] = await h.db.select().from(auditLog).where(eq(auditLog.action, "instance.migrate"));
  expect(a).toMatchObject({ result: "success", targetType: "instance", targetId: tenantInstance });
  // Platform instances: operators choose the project.
  const infra = await post(op, infraInstance, { targetClusterId: far, mode: "copy", targetProject: "ops", targetName: "infra2" });
  expect(infra.body.payload).toMatchObject({ targetProject: "ops", targetName: "infra2" });
});

test("tenant admins migrate their instances between their own placements only", async () => {
  const ta = await h.user("ta@example.com", { tenants: { [acme.id]: "admin" } });
  const r = await post(ta, tenantInstance, { targetClusterId: edge, mode: "copy", transport: "relay", pool: "fast" });
  expect(r.status).toBe(202);
  expect(r.body.payload).toMatchObject({ targetProject: "acme-edge", transport: "auto" });
  expect(r.body.payload.pool).toBeUndefined();
  expect((await post(ta, tenantInstance, { targetClusterId: far, mode: "copy" })).status).toBe(403);
  expect((await post(ta, tenantInstance, { targetClusterId: edge, mode: "copy", targetProject: "default" })).status).toBe(403);
});

test("members and platform viewers may not; strangers do not even see the instance", async () => {
  const m = await h.user("m@example.com", { tenants: { [acme.id]: "member" } });
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  const s = await h.user("s@example.com");
  expect((await post(m, tenantInstance, { targetClusterId: edge, mode: "copy" })).status).toBe(403);
  expect((await post(v, infraInstance, { targetClusterId: edge, mode: "copy" }, true)).status).toBe(403);
  expect((await post(s, tenantInstance, { targetClusterId: edge, mode: "copy" })).status).toBe(404);
  expect(await h.db.select().from(jobs)).toEqual([]);
});

test("pre-flight problems refuse the migration; so do the same cluster, a disabled one and a busy instance", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  targetOver = { instanceNames: ["web"] };
  const r = await post(op, tenantInstance, { targetClusterId: edge, mode: "copy" });
  expect(r.status).toBe(409);
  expect(r.body.error.message).toContain('An instance named "web" already exists on the target');
  targetOver = {};
  expect((await post(op, tenantInstance, { targetClusterId: lab, mode: "copy" })).status).toBe(400);
  await h.db.update(clusters).set({ status: "disabled" }).where(eq(clusters.id, far));
  expect((await post(op, tenantInstance, { targetClusterId: far, mode: "copy" })).status).toBe(400);
  expect((await post(op, tenantInstance, { targetClusterId: edge, mode: "copy" })).status).toBe(202);
  expect((await post(op, tenantInstance, { targetClusterId: edge, mode: "copy" })).status).toBe(409);
  expect(seen.every((x) => x.dst === "edge" && x.targetProject === "acme-edge")).toBe(true);
});
