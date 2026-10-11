import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { relayRequest, relayUpgrade, Upstreams, type RelayTarget } from "./relay.ts";

let fake: FakeIncus;
let front: Server;
let base: string;
let port: number;
const upstreams = new Upstreams();
// biome-ignore lint/suspicious/noExplicitAny: test JSON
const json = async (r: Response): Promise<any> => r.json();

beforeAll(async () => {
  fake = await new FakeIncus().start();
  const target = (req: { url?: string; headers: Record<string, unknown> }): RelayTarget => {
    const pin = req.headers["x-test-pin"] === "bad" ? "00".repeat(32) : fake.fingerprint;
    const url = req.headers["x-test-down"] ? "https://127.0.0.1:1" : fake.url;
    const token = req.headers["x-test-anon"] ? undefined : "tok-123";
    return { url, agent: upstreams.agentFor({ id: `c-${pin}`, fingerprint: pin }), path: req.url ?? "/", token, clientIp: "198.51.100.7" };
  };
  front = createServer((req, res) => relayRequest(req, res, target(req)));
  front.on("upgrade", (req, socket, head) => relayUpgrade(req, socket, head, target(req)));
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  port = (front.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => {
  front.close();
  fake.stop();
});

test("the cluster gets the caller's token and none of our headers or certificates", async () => {
  const r = await fetch(`${base}/1.0/echo`, { headers: { cookie: "ic_session=secret", "x-ic-client-ip": "6.6.6.6", authorization: "Bearer client-sent", "x-forwarded-for": "1.2.3.4" } });
  const h = (await json(r)).metadata.headers;
  expect(h.cookie).toBeUndefined();
  expect(h["x-ic-client-ip"]).toBeUndefined();
  expect(h.authorization).toBe("Bearer tok-123");
  expect(h["x-forwarded-for"]).toBe("198.51.100.7");
  expect(h["x-forwarded-proto"]).toBe("https");
  expect(h.host).toBe(`127.0.0.1:${fake.port}`);
  expect(fake.requests.at(-1)!.clientFingerprint).toBe("");
});

test("anonymous requests carry no Authorization at all", async () => {
  const r = await fetch(`${base}/1.0/echo`, { headers: { "x-test-anon": "1", authorization: "Bearer client-sent" } });
  expect((await json(r)).metadata.headers.authorization).toBeUndefined();
});

test("request bodies stream through, GET bodies included", async () => {
  const r = await fetch(`${base}/1.0/echo`, { method: "POST", body: new Uint8Array(5 << 20) });
  expect((await json(r)).metadata.bodyBytes).toBe(5 << 20);
  // The incus CLI sends GET requests with a body (`incus query`).
  const bytes = await new Promise<number>((resolve, reject) => {
    const q = httpRequest({ host: "127.0.0.1", port, path: "/1.0/echo", method: "GET", headers: { "content-length": "3" } }, (res) => {
      let s = "";
      res.on("data", (d) => (s += d));
      res.on("end", () => resolve(JSON.parse(s).metadata.bodyBytes));
    });
    q.on("error", reject);
    q.end("{}\n");
  });
  expect(bytes).toBe(3);
});

test("large downloads stream with bounded memory", async () => {
  // Fake and relay each run in their own process so RSS measures the relay alone.
  const firstLine = async (p: Bun.Subprocess<"ignore", "pipe">) => new TextDecoder().decode((await p.stdout.getReader().read()).value!).trim();
  const fakeProc = Bun.spawn(["bun", new URL("../test/fake-incus-process.ts", import.meta.url).pathname], { stdout: "pipe" });
  const [fakePort, fp] = (await firstLine(fakeProc)).split(" ");
  const relayProc = Bun.spawn(["bun", new URL("../test/relay-process.ts", import.meta.url).pathname, `https://127.0.0.1:${fakePort}`, fp!], { stdout: "pipe" });
  const relay = `http://127.0.0.1:${await firstLine(relayProc)}`;
  try {
    const idle = Number(await (await fetch(`${relay}/_peak`)).text());
    const r = await fetch(`${relay}/1.0/stream?bytes=${256 << 20}`);
    let n = 0;
    for await (const chunk of r.body!) n += (chunk as Uint8Array).length;
    expect(n).toBe(256 << 20);
    const peak = Number(await (await fetch(`${relay}/_peak`)).text());
    expect(peak - idle).toBeLessThan(64 << 20);
  } finally {
    relayProc.kill();
    fakeProc.kill();
  }
});

test("a cluster presenting another certificate gets nothing and the caller gets an Incus-shaped 502", async () => {
  const seen = fake.requests.length;
  const r = await fetch(`${base}/1.0/echo`, { headers: { "x-test-pin": "bad" } });
  expect(r.status).toBe(502);
  const body = await json(r);
  expect(body).toMatchObject({ type: "error", error_code: 502 });
  expect(body.error).toContain("certificate");
  expect(fake.requests.length).toBe(seen);
});

test("an unreachable cluster is a 502", async () => {
  const r = await fetch(`${base}/1.0`, { headers: { "x-test-down": "1" } });
  expect(r.status).toBe(502);
  expect((await json(r)).type).toBe("error");
});

test("a client that goes away closes the upstream request", async () => {
  const closed = fake.slowClosed;
  const ac = new AbortController();
  const r = await fetch(`${base}/1.0/slow`, { signal: ac.signal });
  const reader = r.body!.getReader();
  await reader.read();
  ac.abort();
  for (let i = 0; i < 50 && fake.slowClosed === closed; i++) await Bun.sleep(20);
  expect(fake.slowClosed).toBe(closed + 1);
});

test("websockets are relayed", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/1.0/ws`);
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  const echo = new Promise<string>((r) => ws.once("message", (m) => r(m.toString())));
  ws.send("ping");
  expect(await echo).toBe("ping");
  expect(fake.upgrades.at(-1)!.headers.authorization).toBe("Bearer tok-123");
  ws.close();
});

const rawUpgrade = (path: string, upgrade: string, payload: string) =>
  new Promise<string>((resolve) => {
    const s = connect(port, "127.0.0.1", () => s.write(`GET ${path} HTTP/1.1\r\nhost: x\r\nconnection: Upgrade\r\nupgrade: ${upgrade}\r\n\r\n`));
    let out = "";
    s.on("data", (d) => {
      out += d;
      if (out.includes("\r\n\r\n") && out.startsWith("HTTP/1.1 101") && !out.includes(payload)) s.write(payload);
      if (out.endsWith(payload)) s.end();
    });
    s.on("close", () => resolve(out));
  });

test("`Upgrade: sftp` is relayed as a raw byte stream", async () => {
  const out = await rawUpgrade("/1.0/sftp", "sftp", "hello-sftp");
  expect(out).toStartWith("HTTP/1.1 101");
  expect(out.endsWith("hello-sftp")).toBe(true);
});

test("an upgrade the cluster refuses is relayed as its answer", async () => {
  const out = await rawUpgrade("/1.0/nope", "websocket", "x");
  expect(out).toStartWith("HTTP/1.1 404");
  expect(out).toContain('"error":"not found"');
});
