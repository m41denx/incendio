// End-to-end check of a running dev server (scripts/dev.sh):
//   bun scripts/smoke.ts [trust-token]
// Signs in as the bootstrap admin through Hydra, reads /api/v1/me and,
// given an Incus trust token, enrols that cluster and lists clusters.
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";

const dev = new URL("../../.dev/", import.meta.url);
const ca = readFileSync(new URL("tls/ca.crt", dev), "utf8");
const password = readFileSync(new URL("admin-password", dev), "utf8").trim();
const base = "https://127.0.0.1:7443";
const b = new TestBrowser(ca);

const health = await b.go(`${base}/healthz`);
console.log("healthz:", health.body);

const login = await b.go(`${base}/auth/start?return_to=/api/v1/me`);
if (!login.url.includes("/auth/login")) throw new Error(`expected the login page, got ${login.url}`);
const me = await b.submit(login, { email: "admin@incuscloud.dev", password });
console.log("me:", me.body);

const token = process.argv[2];
if (token) {
  const csrfless = await fetchJson("POST", "/api/v1/clusters", { name: "cluster-b", token, labels: { env: "dev" } });
  console.log("enrol:", csrfless.status, JSON.stringify(csrfless.body).slice(0, 300));
}
console.log("clusters:", JSON.stringify((await fetchJson("GET", "/api/v1/clusters")).body).slice(0, 500));

async function fetchJson(method: string, path: string, body?: unknown) {
  // Reuse the browser's session cookie.
  const cookie = (b as unknown as { jar: Map<string, Map<string, string>> }).jar.get("127.0.0.1")!;
  const res = await fetch(base + path, {
    method,
    headers: { cookie: [...cookie].map(([k, v]) => `${k}=${v}`).join("; "), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    tls: { ca },
  } as RequestInit);
  return { status: res.status, body: await res.json() };
}
