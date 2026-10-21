// The tenant cloud against two live clusters (scripts/dev.sh running, both enrolled):
//   IC_PUBLIC_URL=… bun scripts/tenant-cloud-e2e.ts [cluster-b] [cluster-c]
// A tenant with a quota on both: the quota split between the two projects,
// a self-service create on automatic placement, the other project's share
// shrinking, over-quota refused by the API and (beyond the share) by Incus,
// and a quota lowered below usage. Leaves the tenant for
// scripts/e2e-cleanup.ts tc-.
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";

const [oneName = "cluster-b", twoName = "cluster-c"] = process.argv.slice(2);
const dev = new URL("../../.dev/", import.meta.url);
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const run = crypto.randomUUID().slice(0, 5);
const slug = `tc-${run}`;
const GiB = 1024 ** 3;
const t0 = performance.now();
const step = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 300_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) {
      step(what);
      return v;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(1000);
  }
}

const browser = new TestBrowser(readFileSync(new URL("tls/ca.crt", dev), "utf8"));
const login = await browser.go(`${base}/auth/start?return_to=/api/v1/me`);
await browser.submit(login, { email: "admin@incuscloud.dev", password: readFileSync(new URL("admin-password", dev), "utf8").trim() });
const call = (method: string, path: string, body?: unknown) => browser.api(base, method, path, body);
const api = async (method: string, path: string, body?: unknown) => {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
/** `incus` inside one of the dev clusters (containers on this host). */
const incus = async (cluster: string, ...args: string[]) => {
  const p = Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim(), err: err.trim() };
};
const limitsOn = async (cluster: string) => {
  const cfg = JSON.parse((await incus(cluster, "query", `/1.0/projects/${slug}`)).out).config as Record<string, string>;
  return { instances: Number(cfg["limits.instances"]), cpu: Number(cfg["limits.cpu"]), memory: Number(cfg["limits.memory"]), disk: Number(cfg["limits.disk"]) };
};
type Usage = { instances: number; cpu: number; memory: number; disk: number };
type TenantUsage = { used: Usage; clusters: Array<{ clusterId: string; clusterName: string; status: string; usage: Usage | null; limits: Partial<Usage> | null }> };
type Job = { id: string; state: string; error: string; result: Record<string, unknown> | null };
const finish = (id: string, what: string) =>
  until(`${what}: job finished`, async () => {
    const j = (await api("GET", `/api/v1/jobs/${id}`)) as Job;
    return ["succeeded", "failed", "cancelled"].includes(j.state) ? j : undefined;
  });

try {
  const all = (await api("GET", "/api/v1/clusters")) as Array<{ id: string; name: string }>;
  const id = (n: string) => {
    const c = all.find((x) => x.name === n);
    if (!c) throw new Error(`cluster ${n} is not enrolled`);
    return c.id;
  };
  const [one, two] = [id(oneName), id(twoName)];
  const nameOf = (cid: string) => (cid === one ? oneName : twoName);

  // A tenant with a quota, on both clusters.
  const me = await api("GET", "/api/v1/me");
  const tenantId = (await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: me.id, quotas: { instances: 3, cpu: 4, memory: 2, disk: 20 } })).id;
  for (const c of [one, two]) await api("PUT", `/api/v1/clusters/${c}/tenants/${tenantId}`);
  const usage = () => api("GET", `/api/v1/tenants/${tenantId}/usage`) as Promise<TenantUsage>;
  await until("the tenant is placed on both, with shares", async () => {
    const u = await usage();
    return u.clusters.length === 2 && u.clusters.every((c) => c.status === "ready" && c.limits?.cpu === 4);
  });
  for (const c of [oneName, twoName]) {
    const l = await limitsOn(c);
    check(l.instances === 3 && l.cpu === 4 && l.memory === 2 * GiB && l.disk === 20 * GiB, `${c}: the whole quota is free, so each project may take all of it (${JSON.stringify(l)})`);
  }

  // A self-service create; IncusCloud picks the cluster.
  const job = await finish((await api("POST", `/api/v1/tenants/${tenantId}/instances`, { name: "w1", image: "alpine/3.22", cpu: 1, memoryGiB: 0.5, diskGiB: 2 })).id, "create w1");
  check(job.state === "succeeded", `the create succeeded${job.error ? `: ${job.error}` : ""}`);
  const at = job.result!.clusterId as string;
  const [here, there] = at === one ? [oneName, twoName] : [twoName, oneName];
  step(`placed on ${nameOf(at)}`);
  const w1 = JSON.parse((await incus(here, "query", `/1.0/instances/w1?project=${slug}`)).out);
  check(w1.status === "Running" && w1.config["limits.cpu"] === "1" && w1.config["limits.memory"] === String(0.5 * GiB) && w1.devices.root.size === String(2 * GiB), "w1 runs with its limits and root size");

  // The other project's share shrinks to what is left.
  await until(`${there}'s share shrinks`, async () => {
    const l = await limitsOn(there);
    return l.instances === 2 && l.cpu === 3 && l.memory === 1.5 * GiB && l.disk === 18 * GiB && l;
  });
  const lHere = await limitsOn(here);
  check(lHere.instances === 3 && lHere.cpu === 4, `${here} keeps its usage plus what is left (${JSON.stringify(lHere)})`);
  const u = await usage();
  check(u.used.instances === 1 && u.used.cpu === 1 && u.used.memory === 0.5 * GiB, `usage API totals ${JSON.stringify(u.used)}`);

  // Over the quota: refused by the API.
  const over = await call("POST", `/api/v1/tenants/${tenantId}/instances`, { name: "w2", image: "alpine/3.22", cpu: 4, memoryGiB: 0.5, diskGiB: 2 });
  check(over.status === 409 && /Over the tenant's quota: cpu: 5 of 4/.test(over.body.error.message), `over quota refused: ${over.body.error?.message}`);

  // Beyond its share directly on the other cluster: refused by Incus.
  const direct = await incus(there, "init", "images:alpine/3.22", "w3", "--project", slug, "-c", "limits.cpu=4", "-c", "limits.memory=256MiB", "-d", "root,size=1GiB");
  check(direct.code !== 0, `Incus refuses beyond the share: ${direct.err.split("\n").pop()}`);

  // Quota lowered below usage: shares equal usage, nothing breaks.
  await api("PATCH", `/api/v1/tenants/${tenantId}`, { quotas: { instances: 3, cpu: 0, memory: 2, disk: 20 } });
  await until("limits follow the lowered quota", async () => {
    const [a, b] = [await limitsOn(here), await limitsOn(there)];
    return a.cpu === 1 && b.cpu === 0;
  });
  check((await usage()).clusters.every((c) => c.status === "ready"), "both placements stay ready");
  // Limit changes must leave the rest of the project alone (Incus replaces a project's config on PATCH).
  for (const c of [here, there]) {
    const cfg = JSON.parse((await incus(c, "query", `/1.0/projects/${slug}`)).out).config as Record<string, string>;
    check(cfg.restricted === "true" && cfg["user.incuscloud.tenant"] === tenantId && cfg["features.networks"] === "false", `${c}: the project is still restricted and the tenant's`);
  }
  console.log("TENANT CLOUD E2E OK");
} catch (e) {
  console.log(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({ slug }));
}
