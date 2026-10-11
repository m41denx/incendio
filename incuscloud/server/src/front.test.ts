import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:https";
import { connect } from "node:tls";
import { Elysia } from "elysia";
import { createFront, type GatewayHandler } from "./front.ts";
import { errorHandling } from "./lib/errors.ts";

const tls = {
  cert: readFileSync(new URL("test/fixtures/test.crt", import.meta.url)),
  key: readFileSync(new URL("test/fixtures/test.key", import.meta.url)),
};
const ca = tls.cert.toString();

const app = new Elysia()
  .use(errorHandling)
  .get("/healthz", () => ({ status: "ok" }))
  .get("/ip", ({ request }) => ({ ip: request.headers.get("x-ic-client-ip") }))
  .post("/echo-length", async ({ request }) => ({ bytes: (await request.arrayBuffer()).byteLength }));

const seen: string[] = [];
const gateway: GatewayHandler = {
  match: (req) => (req.headers.host ?? "").startsWith("c1."),
  request: (req, res) => {
    seen.push(`request ${req.url}`);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("from gateway");
  },
  upgrade: (req, socket) => {
    seen.push(`upgrade ${req.url}`);
    socket.end("HTTP/1.1 101 Switching Protocols\r\nupgrade: sftp\r\nconnection: Upgrade\r\n\r\nraw");
  },
};

let server: Server;
let base: string;
beforeAll(async () => {
  server = createFront({ app, gateway, tls });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const get = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, tls: { ca } } as RequestInit);

test("app routes are served", async () => {
  const r = await get("/healthz");
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ status: "ok" });
});

test("unknown paths get the JSON error shape", async () => {
  const r = await get("/nope");
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
});

test("request bodies stream to the app", async () => {
  const r = await get("/echo-length", { method: "POST", body: new Uint8Array(5 << 20) });
  expect(await r.json()).toEqual({ bytes: 5 << 20 });
});

test("the gateway gets requests it matches", async () => {
  const r = await get("/1.0", { headers: { host: "c1.clusters.test" } });
  expect(await r.text()).toBe("from gateway");
  expect(seen).toContain("request /1.0");
});

test("the gateway gets upgrades it matches; others are refused", async () => {
  const port = (server.address() as AddressInfo).port;
  const raw = (host: string) =>
    new Promise<string>((resolve) => {
      const s = connect({ host: "127.0.0.1", port, ca, servername: "localhost" }, () =>
        s.write(`GET /1.0/instances/x/sftp HTTP/1.1\r\nhost: ${host}\r\nconnection: Upgrade\r\nupgrade: sftp\r\n\r\n`),
      );
      let out = "";
      s.on("data", (d) => (out += d));
      s.on("close", () => resolve(out));
      s.on("error", () => resolve(out));
    });
  expect(await raw("c1.clusters.test")).toContain("101 Switching Protocols");
  expect(seen).toContain("upgrade /1.0/instances/x/sftp");
  expect(await raw("api.test")).toBe("");
});

test("the client address reaches the app and cannot be spoofed", async () => {
  const r = await get("/ip", { headers: { "x-ic-client-ip": "6.6.6.6" } });
  expect(await r.json()).toEqual({ ip: "127.0.0.1" });
});

test("no whole-request timeout: gateway uploads and operation waits run for as long as they need", () => {
  expect((server as unknown as { requestTimeout: number }).requestTimeout).toBe(0);
});
