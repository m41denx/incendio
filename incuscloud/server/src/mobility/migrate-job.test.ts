import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters } from "../db/schema.ts";
import { ClusterError } from "../incus/admin-client.ts";
import type { JobContext } from "../jobs/types.ts";
import type { SourceInstance, TargetFacts } from "./preflight.ts";
import { migrateHandler, type MigratePayload } from "./migrate-job.ts";

type Inst = { status: string; type: string; config: Record<string, string> };
let db: Db;
let log: string[];
let ids: { a: string; b: string };

/** A stub cluster: an instance table and the state/delete calls the handler makes. */
function cluster(label: string, instances: Record<string, Inst>) {
  const asyncOp = { type: "async", status_code: 100, operation: "/1.0/operations/x", metadata: { id: "x", metadata: {} } };
  return {
    instances,
    url: `https://${label}:8443`,
    async request(method: string, path: string, body?: { action?: string }) {
      const name = decodeURIComponent(path.split("?")[0]!.split("/")[3] ?? "");
      const inst = instances[name];
      if (method === "GET" && path.startsWith("/1.0/instances/")) {
        if (!inst) throw new ClusterError(404, "Cluster: Instance not found");
        return { type: "sync", status_code: 200, metadata: { name, ...inst } };
      }
      if (method === "PUT" && path.includes("/state")) {
        log.push(`${label} ${body!.action} ${name}`);
        inst!.status = body!.action === "start" ? "Running" : "Stopped";
        return asyncOp;
      }
      if (method === "DELETE") {
        log.push(`${label} delete ${name}`);
        delete instances[name];
        return asyncOp;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    async wait() {
      return {};
    },
  };
}

const source = (status = "Running", type: "container" | "virtual-machine" = "container"): SourceInstance => ({
  name: "web",
  type,
  status,
  architecture: "aarch64",
  config: { "volatile.uuid": "u" },
  devices: {},
  profiles: ["default"],
  expandedDevices: { root: { type: "disk", path: "/", pool: "p" } },
  snapshots: 0,
  apiExtensions: [],
});
const target = (over: Partial<TargetFacts> = {}): TargetFacts => ({ projectExists: true, architectures: ["aarch64"], pools: ["default"], networks: [], profiles: ["default"], instanceNames: [], defaultProfileDevices: {}, apiExtensions: [], ...over });

function setup(o: { status?: string; mode?: "copy" | "move"; target?: Partial<TargetFacts>; transfer?: (dst: ReturnType<typeof cluster>, request: { name: string; config: Record<string, string> }) => Promise<void>; abort?: boolean }) {
  const a = cluster("A", { web: { status: o.status ?? "Running", type: "container", config: {} } });
  const b = cluster("B", {});
  const abort = new AbortController();
  const payload: MigratePayload = { sourceClusterId: ids.a, sourceProject: "acme", name: "web", targetClusterId: ids.b, targetProject: "acme", targetName: "web", mode: o.mode ?? "move", live: false, transport: "auto" };
  const handler = migrateHandler({
    sourceFacts: async () => source(o.status ?? "Running"),
    targetFacts: async () => target(o.target),
    transfer: async (t) => {
      log.push(`transfer ${t.transport}`);
      if (o.abort) abort.abort(new Error("Cancelled"));
      if (o.transfer) await o.transfer(b, t.request);
      else b.instances[t.request.name] = { status: "Stopped", type: t.request.type, config: t.request.config };
      if (o.abort) throw abort.signal.reason;
      return { transport: "direct" as const };
    },
  });
  const ctx = {
    db,
    secretKey: Buffer.alloc(32),
    job: { id: "job-1", payload },
    signal: abort.signal,
    progress: async () => {},
    clientFor: async (id: string) => ({ client: id === ids.a ? a : b, row: { id, name: id === ids.a ? "A" : "B", serverCert: "PEM", url: id === ids.a ? a.url : b.url } }),
  } as unknown as JobContext;
  return { a, b, run: () => handler(ctx) };
}

beforeEach(async () => {
  db = await testDb();
  log = [];
  const mk = async (name: string) => (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k", inventoryAt: new Date() }).returning())[0]!.id;
  ids = { a: await mk("A"), b: await mk("B") };
});

test("move: stop, transfer, delete the source, start the target; inventories refreshed", async () => {
  const { a, b, run } = setup({});
  expect(await run()).toEqual({ transport: "direct", targetClusterId: ids.b, targetProject: "acme", targetName: "web" });
  expect(log).toEqual(["A stop web", "transfer auto", "B start web", "A delete web"]);
  expect(a.instances.web).toBeUndefined();
  expect(b.instances.web!.status).toBe("Running");
  expect(b.instances.web!.config["user.incuscloud.migrated-from"]).toBe(`${ids.a}/acme/web`);
  expect(b.instances.web!.config["volatile.uuid"]).toBeUndefined();
  expect((await db.select().from(clusters)).every((c) => c.inventoryAt === null)).toBe(true);
});

test("copy: the source keeps running and the copy is not started", async () => {
  const { a, b, run } = setup({ mode: "copy" });
  await run();
  expect(log).toEqual(["transfer auto"]);
  expect(a.instances.web!.status).toBe("Running");
  expect(b.instances.web!.status).toBe("Stopped");
});

test("a failed transfer removes the target this job created and restarts the source", async () => {
  const { a, b, run } = setup({
    transfer: async (dst, request) => {
      dst.instances[request.name] = { status: "Stopped", type: "container", config: request.config };
      throw new Error("Target: disk full");
    },
  });
  await expect(run()).rejects.toThrow("Target: disk full");
  expect(log).toEqual(["A stop web", "transfer auto", "B delete web", "A start web"]);
  expect(b.instances.web).toBeUndefined();
  expect(a.instances.web!.status).toBe("Running");
});

test("an instance on the target that this job did not create is never deleted", async () => {
  const { b, run } = setup({
    transfer: async (dst) => {
      dst.instances.web = { status: "Running", type: "container", config: { "user.incuscloud.job": "someone-else" } };
      throw new Error("Target: Instance name is already in use");
    },
  });
  await expect(run()).rejects.toThrow("already in use");
  expect(b.instances.web).toBeDefined();
  expect(log).not.toContain("B delete web");
});

test("a cancel during the transfer rolls back like a failure", async () => {
  const { a, b, run } = setup({ abort: true });
  await expect(run()).rejects.toThrow("Cancelled");
  expect(b.instances.web).toBeUndefined();
  expect(a.instances.web!.status).toBe("Running");
});

test("pre-flight is checked again when the job runs; problems stop it before anything changes", async () => {
  const { run } = setup({ target: { instanceNames: ["web"] } });
  await expect(run()).rejects.toThrow('An instance named "web" already exists on the target');
  expect(log).toEqual([]);
});
