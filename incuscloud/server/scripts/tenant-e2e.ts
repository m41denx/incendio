// Tenants on a real cluster, end to end (scripts/dev.sh running with IC_DEV_HOST
// set; the cluster enrolled and trusting the dev CA, see dev-cluster-oidc.sh):
//   bun scripts/tenant-e2e.ts [cluster-name]
// A tenant member, logged in with the stock incus CLI both through the gateway
// and directly against the cluster, sees only the tenant's project, can use it,
// cannot touch `default`, and loses access when removed from the tenant.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestBrowser } from "../src/test/browser.ts";

const cluster = process.argv[2] ?? "cluster-b";
const dev = new URL("../../.dev/", import.meta.url);
const ca = readFileSync(new URL("tls/ca.crt", dev), "utf8");
const adminPassword = readFileSync(new URL("admin-password", dev), "utf8").trim();
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const work = mkdtempSync(join(tmpdir(), "ic-tenant-e2e-"));
const env = { ...process.env, INCUS_CONF: join(work, "conf"), SSL_CERT_DIR: `/etc/ssl/certs:${new URL("tls/trust", dev).pathname}` };
const run = crypto.randomUUID().slice(0, 6);
const slug = `e2e-${run}`;
const member = { email: `member-${run}@example.com`, password: crypto.randomUUID() };
const t0 = performance.now();
const step = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};

async function incus(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["incus", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}
async function incusOk(...args: string[]) {
  const r = await incus(...args);
  if (r.code !== 0) throw new Error(`incus ${args.join(" ")} → ${r.code}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

async function signIn(b: TestBrowser, email: string, password: string) {
  const login = await b.go(`${base}/auth/start?return_to=/api/v1/me`);
  const me = await b.submit(login, { email, password });
  if (me.res.status !== 200) throw new Error(`sign-in as ${email} failed: ${me.res.status} ${me.url}`);
}

/** `incus remote add` with OIDC; the device flow is approved in `b` (already signed in, so only the code is asked). */
async function addRemote(b: TestBrowser, name: string, url: string) {
  const p = Bun.spawn(["incus", "remote", "add", name, url, "--auth-type=oidc", "--accept-certificate"], { env, stdout: "pipe", stderr: "pipe" });
  let seen = "";
  const deviceUrl = await new Promise<string>((resolve, reject) => {
    const watch = async (s: ReadableStream<Uint8Array>) => {
      for await (const chunk of s) {
        seen += new TextDecoder().decode(chunk);
        const m = seen.match(/URL: (\S+)/);
        if (m) resolve(m[1]!);
      }
    };
    void watch(p.stdout);
    void watch(p.stderr);
    p.exited.then((c) => reject(new Error(`remote add ${name} exited ${c} before printing a URL: ${seen}`)));
  });
  const page = await b.go(deviceUrl);
  const done = await b.submit(page, { user_code: new URL(deviceUrl).searchParams.get("user_code") ?? "" });
  if (!done.body.includes("Device connected")) throw new Error(`device flow for ${name} did not finish: ${done.url}`);
  if ((await p.exited) !== 0) {
    await Bun.sleep(100);
    throw new Error(`remote add ${name} failed: ${seen.slice(seen.indexOf("URL:"))}`);
  }
}

const admin = new TestBrowser(ca);
const memberBrowser = new TestBrowser(ca);
const api = async (method: string, path: string, body?: unknown) => {
  const r = await admin.api(base, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const projects = async (remote: string) =>
  (await incusOk("project", "list", `${remote}:`, "-f", "csv", "-c", "n"))
    .split("\n")
    .map((l) => l.replace(/ \(current\)$/, "").trim())
    .filter(Boolean)
    .sort();
async function until(what: string, fn: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(500);
  }
  step(`${what}`);
}

let clusterId = "";
let tenantId = "";
let userId = "";
try {
  await signIn(admin, "admin@incuscloud.dev", adminPassword);
  const c = (await api("GET", "/api/v1/clusters")).find((x: { name: string }) => x.name === cluster);
  if (!c) throw new Error(`cluster ${cluster} is not enrolled`);
  clusterId = c.id;
  userId = (await api("POST", "/api/v1/users", { email: member.email, name: "E2E member", password: member.password })).id;
  tenantId = (await api("POST", "/api/v1/tenants", { slug, name: `E2E ${run}`, quotas: { instances: 2, memory: 2 } })).id;
  await api("PUT", `/api/v1/tenants/${tenantId}/members/${userId}`, { role: "member" });
  await api("PUT", `/api/v1/clusters/${clusterId}/tenants/${tenantId}`);
  step(`tenant ${slug} with ${member.email} placed on ${cluster}`);
  await until("placement ready", async () => {
    const p = (await api("GET", `/api/v1/clusters/${clusterId}/tenants`)).find((x: { tenantId: string }) => x.tenantId === tenantId);
    if (p?.status === "error") throw new Error(`placement error: ${p.statusMessage}`);
    return p?.status === "ready";
  });

  await signIn(memberBrowser, member.email, member.password);
  await addRemote(memberBrowser, "gw", `https://${cluster}.127.0.0.1.nip.io:7443`);
  await addRemote(memberBrowser, "direct", c.url);
  step(`member logged in through the gateway and directly (${c.url})`);

  for (const remote of ["gw", "direct"]) {
    const who = JSON.parse(await incusOk("query", `${remote}:/1.0`));
    check(who.auth === "trusted" && who.auth_user_name === userId, `${remote}: authenticated as the member (${who.auth_user_name})`);
    check(JSON.stringify(await projects(remote)) === JSON.stringify([slug]), `${remote}: sees only project ${slug}`);
    // Lists are filtered (empty), reads and writes are refused.
    check((await incusOk("list", `${remote}:`, "--project", "default", "-f", "csv")).trim() === "", `${remote}: lists nothing in project default`);
    const read = await incus("query", `${remote}:/1.0/projects/default`);
    check(read.code !== 0, `${remote}: cannot read project default (${read.err.trim().split("\n").at(-1)})`);
    const write = await incus("init", "images:alpine/3.22", `${remote}:nope`, "--project", "default");
    check(write.code !== 0, `${remote}: cannot create in project default (${write.err.trim().split("\n").at(-1)})`);
  }

  await incusOk("launch", "images:alpine/3.22", "gw:t1", "--project", slug);
  const echo = (await incusOk("exec", "gw:t1", "--project", slug, "--", "echo", "tenant-ok")).trim();
  check(echo === "tenant-ok", "launch and exec in the tenant project through the gateway");
  const direct = await incusOk("list", "direct:", "--project", slug, "-f", "csv", "-c", "ns");
  check(direct.includes("t1,RUNNING"), "the same instance seen directly on the cluster");
  const limits = JSON.parse(await incusOk("query", `direct:/1.0/projects/${slug}`)).config;
  check(limits["limits.instances"] === "2" && limits["limits.memory"] === "2GiB" && limits.restricted === "true", "project restricted with the tenant's quotas");
  const third = await incus("launch", "images:alpine/3.22", "gw:t2", "--project", slug, "-c", "limits.memory=4GiB");
  check(third.code !== 0, `quota enforced by Incus (${third.err.trim().split("\n").at(-1)})`);
  await incusOk("delete", "-f", "gw:t1", "--project", slug);
  await incus("delete", "-f", "gw:t2", "--project", slug);

  const everything = await admin.api(base, "GET", `/clusters/${cluster}/1.0/projects`);
  const names = (everything.body.metadata as string[]).map((p) => p.split("/").at(-1));
  check(names.includes("default") && names.includes(slug), "the platform admin still sees every project");

  await api("DELETE", `/api/v1/tenants/${tenantId}/members/${userId}`);
  await until("membership removal reached the cluster", async () => (await projects("direct")).length === 0);
  const gone = await incus("project", "list", "gw:", "-f", "csv");
  check(gone.code !== 0 && gone.err.includes("no access"), `the gateway refuses the removed member (${gone.err.trim()})`);
  console.log("TENANT E2E OK");
} finally {
  // Instances and the project are not the reconciler's to delete; clean up as the host's admin.
  const inCluster = (...args: string[]) => Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", ...args], { stdout: "ignore", stderr: "ignore" }).exited;
  if (clusterId && tenantId) await admin.api(base, "DELETE", `/api/v1/clusters/${clusterId}/tenants/${tenantId}`);
  if (tenantId) await admin.api(base, "DELETE", `/api/v1/tenants/${tenantId}`);
  if (userId) await admin.api(base, "DELETE", `/api/v1/users/${userId}`);
  await inCluster("delete", "-f", "t1", "t2", "--project", slug);
  for (const img of (await new Response(Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", "image", "list", "--project", slug, "-f", "csv", "-c", "F"], { stdout: "pipe", stderr: "ignore" }).stdout).text()).split("\n").filter(Boolean)) {
    await inCluster("image", "delete", img, "--project", slug);
  }
  await inCluster("project", "delete", slug);
  rmSync(work, { recursive: true, force: true });
}
