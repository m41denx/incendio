import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type AddressInfo } from "node:net";
import { routeRequest } from "./route.ts";
import { serveUi } from "./ui.ts";

let dir: string;
let server: Server;
let base: string;
let signedIn = true;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ic-ui-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Incendio</title>");
  writeFileSync(join(dir, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(join(dir, "..secret"), "no");
  server = createServer((req, res) => {
    const route = routeRequest({ host: "cloud.test", url: req.url }, "clusters.test")!;
    serveUi(req, res, route, { uiDir: dir, signedIn });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true });
});

test("assets are served with their type and cached for good", async () => {
  const r = await fetch(`${base}/clusters/c1/ui/assets/index-abc.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  expect(r.headers.get("cache-control")).toContain("immutable");
  expect(await r.text()).toBe("console.log(1)");
});

test("app routes fall back to index.html, never cached", async () => {
  for (const p of ["/clusters/c1/ui/", "/clusters/c1/ui/project/default/instances", "/clusters/c1/ui/index.html"]) {
    const r = await fetch(base + p);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>Incendio</title>");
    expect(r.headers.get("cache-control")).toBe("no-cache");
  }
});

test("/ui redirects to /ui/", async () => {
  const r = await fetch(`${base}/clusters/c1/ui`, { redirect: "manual" });
  expect(r.status).toBe(301);
  expect(r.headers.get("location")).toBe("/clusters/c1/ui/");
});

/** Sends the request line as is (fetch would normalise dot segments away). */
const rawStatus = (path: string) =>
  new Promise<string>((resolve) => {
    const s = connect(Number(new URL(base).port), "127.0.0.1", () => s.write(`GET ${path} HTTP/1.1\r\nhost: cloud.test\r\nconnection: close\r\n\r\n`));
    let out = "";
    s.on("data", (d) => (out += d));
    s.on("close", () => resolve(out.slice(9, 12)));
  });

test("missing files with an extension are 404; traversal never escapes", async () => {
  expect((await fetch(`${base}/clusters/c1/ui/assets/nope.js`)).status).toBe(404);
  for (const p of ["/clusters/c1/ui/../..secret", "/clusters/c1/ui/%2e%2e/%2e%2esecret", "/clusters/c1/ui/..%2F..secret", "/clusters/c1/ui/assets/..%2F..%2F..secret", "/clusters/c1/ui/..%2F..%2Fetc%2Fpasswd"]) {
    expect(`${p} ${await rawStatus(p)}`).toBe(`${p} 404`);
  }
});

test("pages need a session; assets do not", async () => {
  signedIn = false;
  const r = await fetch(`${base}/clusters/c1/ui/project/default/instances?x=1`, { redirect: "manual" });
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe(`/auth/start?return_to=${encodeURIComponent("/clusters/c1/ui/project/default/instances?x=1")}`);
  expect((await fetch(`${base}/clusters/c1/ui/assets/index-abc.js`)).status).toBe(200);
  signedIn = true;
});
