import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serveWeb } from "./web.ts";

const dir = new URL("test/fixtures/web/", import.meta.url).pathname;
let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (!serveWeb(req, res, { dir, imageServers: ["https://images.example", "https://mirror.example:8443/streams"] })) {
      res.writeHead(599);
      res.end("not handled");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

test("the index at / and for app routes (deep links survive a reload)", async () => {
  for (const path of ["/", "/tenants/1234", "/clusters/abc?tab=tenants"]) {
    const r = await fetch(base + path);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(await r.text()).toContain("<title>IncusCloud");
  }
});

test("assets are typed and cached forever; other files are served", async () => {
  const a = await fetch(`${base}/assets/app-abc123.js`);
  expect(a.headers.get("content-type")).toContain("javascript");
  expect(a.headers.get("cache-control")).toContain("immutable");
  expect((await fetch(`${base}/manifest.json`)).headers.get("content-type")).toContain("json");
  expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
});

test("API, sign-in and health paths, other methods and traversal are not the web's", async () => {
  for (const path of ["/api/v1/me", "/auth/start", "/healthz"]) expect((await fetch(base + path)).status).toBe(599);
  expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(599);
  expect((await fetch(`${base}/assets/..%2F..%2Fweb.test.ts`)).status).toBe(404);
  expect((await fetch(`${base}/..%2Fweb.ts`)).status).not.toBe(200);
});

test("pages cannot be framed by other sites and only load our own scripts", async () => {
  const r = await fetch(`${base}/tenants`);
  expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(r.headers.get("referrer-policy")).toBe("same-origin");
  const csp = r.headers.get("content-security-policy") ?? "";
  for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'"]) expect(csp).toContain(d);
});

test("pages may read the image servers' catalogues (Incendio's image picker) and nothing else outside", async () => {
  const csp = (await fetch(`${base}/ui/project/acme@c1/instances/create`)).headers.get("content-security-policy") ?? "";
  expect(csp).toContain("connect-src 'self' https://images.example https://mirror.example:8443;");
});
