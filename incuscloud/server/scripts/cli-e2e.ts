// End to end through the gateway with the stock `incus` CLI (scripts/dev.sh
// running with IC_DEV_HOST set, the cluster enrolled and its oidc.* pointing
// at the dev Hydra, see scripts/dev-cluster-oidc.sh):
//   bun scripts/cli-e2e.ts [cluster-name]
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestBrowser } from "../src/test/browser.ts";

const cluster = process.argv[2] ?? "cluster-b";
const dev = new URL("../../.dev/", import.meta.url);
const ca = readFileSync(new URL("tls/ca.crt", dev), "utf8");
const password = readFileSync(new URL("admin-password", dev), "utf8").trim();
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const remote = `https://${cluster}.127.0.0.1.nip.io:7443`;
const work = mkdtempSync(join(tmpdir(), "ic-e2e-"));
// The CLI must trust the dev CA in front of Hydra, like a user trusting a private CA.
const env = { ...process.env, INCUS_CONF: join(work, "conf"), SSL_CERT_DIR: `/etc/ssl/certs:${new URL("tls/trust", dev).pathname}` };
const browser = new TestBrowser(ca);
const t0 = performance.now();
const step = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function incus(...args: string[]): Promise<string> {
  const p = Bun.spawn(["incus", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`incus ${args.join(" ")} → ${code}: ${err.trim() || out.trim()}`);
  return out;
}

async function login() {
  // `remote add` runs the device flow: it prints a URL and waits for us to approve.
  const p = Bun.spawn(["incus", "remote", "add", cluster, remote, "--auth-type=oidc", "--accept-certificate"], { env, stdout: "pipe", stderr: "pipe" });
  let seen = "";
  const url = await new Promise<string>((resolve, reject) => {
    const watch = async (s: ReadableStream<Uint8Array>) => {
      for await (const chunk of s) {
        seen += new TextDecoder().decode(chunk);
        const m = seen.match(/URL: (\S+)/);
        if (m) return resolve(m[1]!);
      }
    };
    void watch(p.stdout);
    void watch(p.stderr);
    p.exited.then((c) => reject(new Error(`remote add exited ${c} before printing a URL: ${seen}`)));
  });
  step(`device flow: ${url}`);
  const devicePage = await browser.go(url);
  const loginPage = await browser.submit(devicePage, { user_code: new URL(url).searchParams.get("user_code") ?? "" });
  const done = await browser.submit(loginPage, { email: "admin@incuscloud.dev", password });
  if (!done.body.includes("Device connected")) throw new Error(`device flow did not finish: ${done.url}`);
  if ((await p.exited) !== 0) throw new Error(`remote add failed: ${seen}`);
}

try {
  await login();
  step("remote added");
  const info = await incus("query", `${cluster}:/1.0`);
  const server = JSON.parse(info);
  step(`server: auth=${server.auth} method=${server.auth_method} user=${server.auth_user_name}`);
  if (server.auth !== "trusted") throw new Error("not trusted through the gateway");

  await incus("launch", "images:alpine/3.22", `${cluster}:e2e`);
  step("launched e2e");
  const echo = (await incus("exec", `${cluster}:e2e`, "--", "echo", "exec-ok")).trim();
  step(`exec: ${echo}`);
  if (echo !== "exec-ok") throw new Error(`exec printed ${echo}`);

  const file = join(work, "blob");
  writeFileSync(file, crypto.getRandomValues(new Uint8Array(32 << 20).fill(0).map((_, i) => i * 7)) as Uint8Array);
  const want = new Bun.CryptoHasher("sha256").update(readFileSync(file)).digest("hex");
  await incus("file", "push", file, `${cluster}:e2e/root/blob`);
  await incus("file", "pull", `${cluster}:e2e/root/blob`, join(work, "back"));
  const got = new Bun.CryptoHasher("sha256").update(readFileSync(join(work, "back"))).digest("hex");
  step(`file push/pull 32 MiB: ${got === want ? "sha256 match" : "MISMATCH"}`);
  if (got !== want) throw new Error("file round trip changed the content");

  const list = await incus("list", `${cluster}:`, "-f", "csv", "-c", "ns");
  step(`list: ${list.trim().replaceAll("\n", " | ")}`);
  await incus("delete", "-f", `${cluster}:e2e`);
  step("deleted e2e");

  // The browser path: platform session → Incendio and the API through /clusters/<name>.
  const signedIn = await browser.go(`${base}/auth/start?return_to=/api/v1/me`);
  step(`browser session: ${signedIn.res.status} ${signedIn.url}`);
  const ui = await browser.go(`${base}/clusters/${cluster}/ui/`);
  step(`incendio: ${ui.res.status} ${ui.body.includes("<title>Incendio") ? "Incendio index" : ui.body.slice(0, 80)}`);
  const viaPath = await browser.api(base, "GET", `/clusters/${cluster}/1.0`);
  step(`/clusters/${cluster}/1.0 with the session: auth=${viaPath.body.metadata?.auth}`);

  const clusters = await browser.api(base, "GET", "/api/v1/clusters");
  const id = clusters.body.find((c: { name: string }) => c.name === cluster)?.id;
  await Bun.sleep(1500); // request log flushes every second
  const logged = await browser.api(base, "GET", `/api/v1/gateway-requests?cluster=${id}&limit=500`);
  const kinds = new Map<string, number>();
  for (const r of logged.body as Array<{ method: string; path: string; status: number }>) {
    const k = `${r.method} ${r.path.replace(/\/[0-9a-f-]{36}/g, "/<id>")} ${r.status}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  step(`gateway log: ${logged.body.length} rows`);
  for (const [k, n] of kinds) console.log(`    ${n}× ${k}`);
  console.log("E2E OK");
} finally {
  await incus("delete", "-f", `${cluster}:e2e`).catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
