import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, placements, tenants } from "../db/schema.ts";
import { ClusterError } from "../incus/admin-client.ts";
import type { JobContext } from "../jobs/types.ts";
import { createHandler, type CreatePayload } from "./create-job.ts";

const GiB = 1024 ** 3;
let db: Db;
let lab: string;
let edge: string;
let tenantId: string;

beforeEach(async () => {
  db = await testDb();
  const mk = async (name: string) => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", inventoryAt: new Date() }).returning())[0]!.id;
  lab = await mk("lab");
  edge = await mk("edge");
  tenantId = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning())[0]!.id;
  await db.insert(placements).values([
    { tenantId, clusterId: lab, project: "acme", status: "ready" },
    { tenantId, clusterId: edge, project: "acme", status: "ready" },
  ]);
});

/** A cluster that knows one project's default profile and instances. */
function fakeCluster(o: { existing?: string[]; pool?: string | null } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const names = new Set(o.existing ?? []);
  const client = {
    calls,
    async request(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body });
      const p = path.split("?")[0]!;
      if (method === "GET" && p.startsWith("/1.0/instances/")) {
        if (!names.has(decodeURIComponent(p.split("/")[3]!))) throw new ClusterError(404, "Cluster: Instance not found");
        return { type: "sync", status_code: 200, metadata: {} };
      }
      if (method === "GET" && p === "/1.0/profiles/default")
        return { type: "sync", status_code: 200, metadata: { devices: o.pool === null ? {} : { root: { type: "disk", path: "/", pool: o.pool ?? "local" } } } };
      if (method === "POST" && p === "/1.0/instances") {
        names.add((body as { name: string }).name);
        return { type: "async", status_code: 202, operation: "/1.0/operations/op1", metadata: {} };
      }
      if (p === "/1.0/operations/op1/wait") return { type: "sync", status_code: 200, metadata: { status: "Success", err: "" } };
      if (method === "GET" && p === "/1.0/projects/acme/state") return { type: "sync", status_code: 200, metadata: { resources: { instances: { Usage: 1 }, cpu: { Usage: 2 }, memory: { Usage: GiB }, disk: { Usage: 8 * GiB } } } };
      throw new Error(`unexpected ${method} ${path}`);
    },
    async cancel() {},
  };
  return client;
}

const payload = (o: Partial<CreatePayload> = {}): CreatePayload => ({ tenantId, clusterId: lab, project: "acme", name: "web", image: "debian/12", type: "container", cpu: 2, memory: GiB, disk: 8 * GiB, start: true, ...o });
const run = (client: ReturnType<typeof fakeCluster>, p: CreatePayload) =>
  createHandler({ imageServer: "https://images.example" })({
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "00000000-0000-4000-8000-00000000000c", tenantId, payload: p },
    signal: new AbortController().signal,
    progress: async () => {},
    clientFor: async () => ({ client, row: { id: lab, name: "lab" } }),
  } as unknown as JobContext);

test("creates from the image server with its limits and a sized root disk on the profile's pool; usage and reconcile follow", async () => {
  const c = fakeCluster({ pool: "fast" });
  const r = await run(c, payload());
  expect(r).toEqual({ clusterId: lab, project: "acme", name: "web" });
  const post = c.calls.find((x) => x.method === "POST")!;
  expect(post.path).toBe("/1.0/instances?project=acme");
  expect(post.body).toEqual({
    name: "web",
    type: "container",
    source: { type: "image", alias: "debian/12", server: "https://images.example", protocol: "simplestreams" },
    config: { "limits.cpu": "2", "limits.memory": String(GiB) },
    devices: { root: { type: "disk", path: "/", pool: "fast", size: String(8 * GiB) } },
    start: true,
  });
  // The new usage is recorded at once, and every cluster of the tenant is asked to re-split.
  const [p] = await db.select().from(placements).where(eq(placements.clusterId, lab));
  expect(p!.usage).toEqual({ instances: 1, cpu: 2, memory: GiB, disk: 8 * GiB });
  const cs = await db.select().from(clusters);
  expect(cs.every((x) => x.reconcileRequestedAt !== null)).toBe(true);
  expect(cs.find((x) => x.id === lab)!.inventoryAt).toBeNull();
});

test("a taken name is refused before anything is created", async () => {
  const c = fakeCluster({ existing: ["web"] });
  await expect(run(c, payload())).rejects.toThrow('An instance named "web" already exists in acme');
  expect(c.calls.some((x) => x.method === "POST")).toBe(false);
});

test("a project whose default profile has no root disk is reported", async () => {
  await expect(run(fakeCluster({ pool: null }), payload())).rejects.toThrow(/no root disk/);
});
