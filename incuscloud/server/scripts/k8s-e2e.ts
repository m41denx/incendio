// Kubernetes (P10) against a live cluster, with scripts/dev.sh running on a
// management cluster (IC_K8S_KUBECONFIG, see scripts/dev-mgmt.sh):
//   IC_PUBLIC_URL=… bun scripts/k8s-e2e.ts [cluster-b]
// A tenant with a quota: a cluster created through the API, its API answering
// through the forwarded endpoint with the downloaded kubeconfig, a worker
// added, scaling over the quota refused, and a delete that leaves nothing on
// the Incus cluster. Leaves the tenant for scripts/e2e-cleanup.ts k8s-.
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";
import { parseKubeconfig } from "../src/k8s/kube.ts";

const [clusterName = "cluster-b"] = process.argv.slice(2);
const dev = new URL("../../.dev/", import.meta.url);
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const run = crypto.randomUUID().slice(0, 5);
const slug = `k8s-${run}`;
const VERSION = "v1.36.4";
const t0 = performance.now();
const step = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 600_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) {
      step(what);
      return v;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(3000);
  }
}

const browser = new TestBrowser(readFileSync(new URL("tls/ca.crt", dev), "utf8"));
await browser.submit(await browser.go(`${base}/auth/start?return_to=/api/v1/me`), { email: "admin@incuscloud.dev", password: readFileSync(new URL("admin-password", dev), "utf8").trim() });
const call = (method: string, path: string, body?: unknown) => browser.api(base, method, path, body);
const api = async (method: string, path: string, body?: unknown) => {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const incus = async (...args: string[]) => {
  const p = Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", clusterName, "--", "incus", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, , code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim() };
};
type Job = { id: string; state: string; error: string };
const finish = (id: string, what: string, ms = 1_800_000) =>
  until(`${what}: job finished`, async () => {
    const j = (await api("GET", `/api/v1/jobs/${id}`)) as Job;
    return ["succeeded", "failed", "cancelled"].includes(j.state) ? j : undefined;
  }, ms);

let k8sId = "";
try {
  check(((await api("GET", "/api/v1/kubernetes/versions")) as { enabled: boolean }).enabled, "Kubernetes is enabled");
  const clusters = (await api("GET", "/api/v1/clusters")) as Array<{ id: string; name: string }>;
  const clusterId = clusters.find((c) => c.name === clusterName)?.id;
  if (!clusterId) throw new Error(`cluster ${clusterName} is not enrolled`);

  // A tenant with room for a control plane, one worker and the load balancer, not more.
  const me = await api("GET", "/api/v1/me");
  const tenantId = (await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: me.id, quotas: { instances: 4 } })).id as string;
  await api("PUT", `/api/v1/clusters/${clusterId}/tenants/${tenantId}`);
  await until("the tenant's project is ready", async () => ((await api("GET", `/api/v1/tenants/${tenantId}/placements`)) as Array<{ status: string }>)[0]?.status === "ready");

  // 1–2. Create through the API; the job brings the control plane up.
  const created = await api("POST", "/api/v1/kubernetes", { tenantId, clusterId, name: "e2e", version: VERSION, controlPlanes: 1, workers: 0, size: "small" });
  k8sId = created.cluster.id;
  step(`creating e2e on ${created.cluster.endpoint}`);
  const job = await finish(created.job.id, "create");
  check(job.state === "succeeded", `the create job succeeded (${job.error || "no error"})`);

  // 3. The workload API answers through the forwarded endpoint, with the downloaded kubeconfig.
  const kubeconfig = await call("GET", `/api/v1/kubernetes/${k8sId}/kubeconfig`);
  check(kubeconfig.status === 200 && typeof kubeconfig.body === "string", "the kubeconfig downloads");
  const access = parseKubeconfig(kubeconfig.body);
  check(access.server === created.cluster.endpoint, `its server is the endpoint (${access.server})`);
  const kube = async (path: string) => {
    const r = await fetch(`${access.server}${path}`, { tls: { ca: access.ca, cert: access.cert, key: access.key }, signal: AbortSignal.timeout(10_000) } as RequestInit);
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  };
  const version = (await kube("/version")) as { gitVersion: string };
  check(version.gitVersion === VERSION, `the workload API answers: ${version.gitVersion}`);
  const ready = async () =>
    ((await kube("/api/v1/nodes")) as { items: Array<{ status: { conditions: Array<{ type: string; status: string }> } }> }).items.filter((n) =>
      n.status.conditions.some((c) => c.type === "Ready" && c.status === "True"),
    ).length;
  await until("the control plane node is Ready", async () => (await ready()) === 1);

  // 4. A worker joins.
  await api("PATCH", `/api/v1/kubernetes/${k8sId}`, { workers: 1 });
  await until("the worker joined and is Ready", async () => (await ready()) === 2);
  await until("IncusCloud sees it ready, 2 of 2", async () => {
    const k = await api("GET", `/api/v1/kubernetes/${k8sId}`);
    return k.status === "ready" && k.nodesReady === 2;
  });

  // 5. Over the quota is refused once the usage is measured (3 of 4 instances).
  await until("the tenant's usage counts the nodes and the load balancer", async () => ((await api("GET", `/api/v1/tenants/${tenantId}/usage`)) as { used: { instances: number } }).used.instances === 3, 180_000);
  const over = await call("PATCH", `/api/v1/kubernetes/${k8sId}`, { workers: 3 });
  check(over.status === 409 && over.body.error.code === "quota_exceeded", `scaling over the quota is refused: ${over.body.error?.message}`);

  // 6. Delete: nothing of it stays on the Incus cluster.
  const del = await api("DELETE", `/api/v1/kubernetes/${k8sId}`);
  const deleted = await finish(del.id, "delete", 600_000);
  check(deleted.state === "succeeded", `the delete job succeeded (${deleted.error || "no error"})`);
  k8sId = "";
  check((await incus("list", "--project", slug, "-f", "csv", "-c", "n")).out === "", "no instances are left in the project");
  const forwards = await incus("query", "/1.0/networks/incusbr0/forwards?recursion=1");
  check(!forwards.out.includes(`incuscloud k8s ${created.cluster.id}`), "its forward port is gone");
  check(!(await incus("config", "trust", "list", "-f", "csv", "-c", "n")).out.includes(`incuscloud-k8s-${slug}`), "its certificate is no longer trusted");
  check(((await api("GET", `/api/v1/kubernetes?tenant=${tenantId}`)) as unknown[]).length === 0, "the API lists nothing");
  step(`passed; leaves tenant ${slug} for scripts/e2e-cleanup.ts k8s-`);
} finally {
  if (k8sId) {
    step(`cleaning up: deleting ${k8sId}`);
    await call("DELETE", `/api/v1/kubernetes/${k8sId}`).catch(() => {});
  }
}
