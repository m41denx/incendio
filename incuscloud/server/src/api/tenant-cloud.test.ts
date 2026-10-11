import { beforeEach, expect, test } from "bun:test";
import { clusters, placements, tenants } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { harness } from "../test/harness.ts";

const GiB = 1024 ** 3;
let h: Awaited<ReturnType<typeof harness>>;
let acme: { id: string };
let lab: string;
let edge: string;

beforeEach(async () => {
  h = await harness();
  const mk = async (name: string, labels: Record<string, string> = {}) => (await h.db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready", labels }).returning())[0]!.id;
  lab = await mk("lab", { region: "eu" });
  edge = await mk("edge", { region: "us" });
  acme = await h.tenant("acme");
  await h.db.update(tenants).set({ quotas: { instances: 5, memory: 8 } }).where(eq(tenants.id, acme.id));
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready", usage: { instances: 1, cpu: 1, memory: GiB, disk: 10 * GiB }, limits: { instances: 3, memory: 5 * GiB } },
    { tenantId: acme.id, clusterId: edge, project: "acme-e", status: "ready", usage: { instances: 1, cpu: 2, memory: 2 * GiB, disk: 0 }, limits: { instances: 4, memory: 7 * GiB } },
  ]);
});

test("usage: the quota, the total and each cluster's share; tenant viewers and platform viewers, nobody else", async () => {
  const viewer = await h.user("v@example.com", { tenants: { [acme.id]: "viewer" } });
  const staff = await h.user("s@example.com", { platformRole: "viewer" });
  const other = await h.user("o@example.com");
  const r = await h.call(viewer, "GET", `/api/v1/tenants/${acme.id}/usage`);
  expect(r.status).toBe(200);
  expect(r.body.quota).toEqual({ instances: 5, memory: 8 });
  expect(r.body.used).toEqual({ instances: 2, cpu: 3, memory: 3 * GiB, disk: 10 * GiB });
  expect(r.body.clusters).toEqual([
    { clusterId: edge, clusterName: "edge", project: "acme-e", status: "ready", usage: { instances: 1, cpu: 2, memory: 2 * GiB, disk: 0 }, limits: { instances: 4, memory: 7 * GiB } },
    { clusterId: lab, clusterName: "lab", project: "acme", status: "ready", usage: { instances: 1, cpu: 1, memory: GiB, disk: 10 * GiB }, limits: { instances: 3, memory: 5 * GiB } },
  ]);
  expect((await h.call(staff, "GET", `/api/v1/tenants/${acme.id}/usage`)).status).toBe(200);
  expect((await h.call(other, "GET", `/api/v1/tenants/${acme.id}/usage`)).status).toBe(404);
  expect((await h.call(staff, "GET", "/api/v1/tenants/not-a-uuid/usage")).status).toBe(404);
});
