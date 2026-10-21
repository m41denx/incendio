import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type WebSocketType from "ws";
import { ClusterError } from "../incus/admin-client.ts";
import { forward, pipe, progressText, transfer, type TransferSide } from "./transfer.ts";

const require_ = createRequire(import.meta.url);
// The real ws package (Bun's built-in has no server); its types are not Bun's.
// biome-ignore lint/suspicious/noExplicitAny: see above
const WS: any = require_(join(dirname(require_.resolve("ws/package.json")), "index.js"));

const servers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});
/** A local websocket server; resolves its first connection's server side and a client socket. */
async function pair() {
  const server = new WS.Server({ port: 0, host: "127.0.0.1" });
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const serverSide = new Promise<WebSocketType>((r) => server.once("connection", r));
  const client = new WS(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  await new Promise((r) => client.once("open", r));
  return { client, server: await serverSide };
}

test("pipe relays both ways, keeping message boundaries and binary frames", async () => {
  const a = await pair();
  const b = await pair();
  const done = pipe(a.client, b.client);
  const atB: Array<[string, boolean]> = [];
  const atA: string[] = [];
  b.server.on("message", (d, bin) => atB.push([bin ? `bin:${(d as Buffer).length}` : String(d), bin]));
  a.server.on("message", (d) => atA.push(String(d)));
  a.server.send("one");
  a.server.send("two");
  a.server.send(Buffer.alloc(70_000), { binary: true });
  b.server.send("back");
  for (let i = 0; i < 100 && (atB.length < 3 || atA.length < 1); i++) await Bun.sleep(10);
  expect(atB).toEqual([
    ["one", false],
    ["two", false],
    ["bin:70000", true],
  ]);
  expect(atA).toEqual(["back"]);
  a.server.close();
  await done;
  expect(b.client.readyState).toBeGreaterThanOrEqual(WS.CLOSING);
});

test("a slow side pauses the other until it drains", () => {
  const from = Object.assign(new EventEmitter(), { isPaused: false, pause: () => (from.isPaused = true), resume: () => (from.isPaused = false) });
  let queued = 0;
  const callbacks: Array<() => void> = [];
  const to = {
    readyState: 1,
    get bufferedAmount() {
      return queued;
    },
    send: (d: Buffer, _o: unknown, cb: () => void) => {
      queued += d.length;
      callbacks.push(() => {
        queued -= d.length;
        cb();
      });
    },
  };
  forward(from as never, to as never);
  from.emit("message", Buffer.alloc(5 << 20), true);
  expect(from.isPaused).toBe(true);
  callbacks.shift()!();
  expect(from.isPaused).toBe(false);
});

test("progress text from the shapes Incus operations report", () => {
  expect(progressText({ fs_progress: "web: 120.00MB (40.00MB/s)" })).toBe("web: 120.00MB (40.00MB/s)");
  expect(progressText({ create_instance_from_migration_progress: "50% (10MB/s)" })).toBe("50% (10MB/s)");
  expect(progressText({ progress: { percent: "42", speed: "1.5MB/s", stage: "migrate" } })).toBe("42% (1.5MB/s)");
  expect(progressText({ control: "secret" })).toBeUndefined();
  expect(progressText(null)).toBeUndefined();
});

/** Stub cluster: records requests; answers from a script. */
function side(url: string, script: (method: string, path: string, body: unknown) => unknown): TransferSide & { calls: Array<[string, string, unknown]>; sockets: string[]; cancelled: string[] } {
  const s = {
    url,
    calls: [] as Array<[string, string, unknown]>,
    sockets: [] as string[],
    cancelled: [] as string[],
    async request<T>(method: string, path: string, body?: unknown) {
      s.calls.push([method, path, body]);
      const r = script(method, path, body);
      if (r instanceof Error) throw r;
      return r as { type: "sync"; status_code: number; metadata: T };
    },
    async websocket(path: string) {
      s.sockets.push(path);
      const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, isPaused: false, send() {}, pause() {}, resume() {}, close: () => ws.emit("close") });
      return ws as never;
    },
    async cancel(op: string) {
      s.cancelled.push(op);
    },
  };
  return s;
}
const asyncOp = (id: string, secrets: Record<string, string>) => ({ type: "async", status_code: 100, operation: `/1.0/operations/${id}`, metadata: { id, metadata: secrets } });
const finished = (status = "Success", err = "") => ({ type: "sync", status_code: 200, metadata: { status, err, metadata: {} } });
const request = { name: "web", type: "container", architecture: "aarch64", config: {}, devices: {}, profiles: ["default"] };
const base = { srcProject: "p", dstProject: "q", name: "web", request, refresh: false, live: false, instanceOnly: false, targetCert: "PEM", signal: new AbortController().signal, onProgress: async () => {} };

test("direct: the target waits in push mode and the source is told to connect to it", async () => {
  const src = side("https://a:8443", (m) => (m === "POST" ? asyncOp("s1", {}) : finished()));
  const dst = side("https://b:8443", (m) => (m === "POST" ? asyncOp("t1", { control: "c", fs: "f" }) : finished()));
  expect(await transfer({ ...base, src, dst, transport: "auto" })).toEqual({ transport: "direct" });
  const [, path, body] = dst.calls[0]!;
  expect(path).toBe("/1.0/instances?project=q");
  expect(body).toMatchObject({ ...request, source: { type: "migration", mode: "push", refresh: false, live: false, instance_only: false } });
  expect(src.calls[0]).toEqual(["POST", "/1.0/instances/web?project=p", { migration: true, live: false, instance_only: false, target: { operation: "https://b:8443/1.0/operations/t1", certificate: "PEM", secrets: { control: "c", fs: "f" } } }]);
  expect(dst.sockets).toEqual([]);
});

test("auto: a source that cannot reach the target falls back to relaying the websockets", async () => {
  let n = 0;
  const src = side("https://a:8443", (m, p) => {
    if (m === "POST") return asyncOp(`s${++n}`, n === 1 ? {} : { control: "c", fs: "f" });
    return p.startsWith("/1.0/operations/s1") ? finished("Failure", "Failed to connect: dial tcp b:8443: connect: no route to host") : finished();
  });
  let posts = 0;
  const dst = side("https://b:8443", (m) => {
    if (m === "POST") return ++posts === 1 ? asyncOp("t1", { control: "x" }) : asyncOp("t2", { control: "tc", fs: "tf" });
    return posts === 1 ? { type: "sync", status_code: 200, metadata: { status: "Running", err: "", metadata: {} } } : finished();
  });
  expect(await transfer({ ...base, src, dst, transport: "auto" })).toEqual({ transport: "relay" });
  expect(dst.cancelled).toEqual(["/1.0/operations/t1"]);
  expect(src.calls.filter(([m]) => m === "POST")[1]![2]).toEqual({ migration: true, live: false, instance_only: false });
  expect(src.sockets).toEqual(["/1.0/operations/s2/websocket?secret=c", "/1.0/operations/s2/websocket?secret=f"]);
  expect(dst.sockets).toEqual(["/1.0/operations/t2/websocket?secret=tc", "/1.0/operations/t2/websocket?secret=tf"]);
});

test("other failures are not retried; they fail with the side's message", async () => {
  const src = side("https://a:8443", (m) => (m === "POST" ? asyncOp("s1", {}) : finished()));
  const dst = side("https://b:8443", (m) => (m === "POST" ? asyncOp("t1", { control: "c" }) : finished("Failure", "Instance name is already in use")));
  await expect(transfer({ ...base, src, dst, transport: "auto" })).rejects.toThrow("Target: Instance name is already in use");
  expect(src.cancelled).toEqual(["/1.0/operations/s1"]);
});

test("a refused source is reported as the source's, and the waiting target is cancelled", async () => {
  const src = side("https://a:8443", () => new ClusterError(400, "Cluster: Instance is running"));
  const dst = side("https://b:8443", (m) => (m === "POST" ? asyncOp("t1", { control: "c" }) : finished()));
  await expect(transfer({ ...base, src, dst, transport: "direct" })).rejects.toThrow("Source: Cluster: Instance is running");
  expect(dst.cancelled).toEqual(["/1.0/operations/t1"]);
});

test("aborting cancels both operations", async () => {
  const abort = new AbortController();
  const src = side("https://a:8443", (m) => (m === "POST" ? asyncOp("s1", {}) : { type: "sync", status_code: 200, metadata: { status: "Running", err: "", metadata: {} } }));
  const dst = side("https://b:8443", (m) => {
    if (m === "POST") return asyncOp("t1", { control: "c" });
    abort.abort(new Error("Cancelled"));
    return { type: "sync", status_code: 200, metadata: { status: "Running", err: "", metadata: { fs_progress: "1MB" } } };
  });
  await expect(transfer({ ...base, src, dst, transport: "direct", signal: abort.signal })).rejects.toThrow("Cancelled");
  expect(src.cancelled).toEqual(["/1.0/operations/s1"]);
  expect(dst.cancelled).toEqual(["/1.0/operations/t1"]);
});
