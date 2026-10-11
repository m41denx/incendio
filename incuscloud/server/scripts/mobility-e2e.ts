// Mobility between two real clusters, end to end (scripts/dev.sh running,
// both clusters enrolled; see README "Mobility"):
//   bun scripts/mobility-e2e.ts [from=cluster-b] [to=cluster-c]
// Copies (direct) and moves (relay) an instance between the clusters through the
// API, cancels a transfer mid-way, then replicates and fails over.
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";

const [fromName = "cluster-b", toName = "cluster-c"] = process.argv.slice(2);
const dev = new URL("../../.dev/", import.meta.url);
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const run = crypto.randomUUID().slice(0, 6);
const slug = `mob-${run}`;
const t0 = performance.now();
const step = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 180_000): Promise<T> {
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
const api = async (method: string, path: string, body?: unknown, ok = true) => {
  const r = await browser.api(base, method, path, body);
  if (ok && r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};
/** The host's admin on a nested cluster: `incus …` inside it. */
const inCluster = async (cluster: string, ...args: string[]) => {
  const p = Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim(), err: err.trim() };
};
const instanceId = (cluster: string, name: string) =>
  until(`${name} on ${cluster} is in the inventory`, async () => {
    const items = (await api("GET", `/api/v1/instances?q=${name}`)).body.items as Array<{ id: string; name: string; clusterName: string }>;
    return items.find((i) => i.name === name && i.clusterName === cluster)?.id;
  });
type Job = { id: string; state: string; error: string; result: Record<string, unknown> | null; progress: { stage: string; message?: string } };
const finish = (id: string, what: string) =>
  until(`${what}: job finished`, async () => {
    const j = (await api("GET", `/api/v1/jobs/${id}`)).body as Job;
    return ["succeeded", "failed", "cancelled"].includes(j.state) ? j : undefined;
  });
const marker = async (cluster: string, name: string) => (await inCluster(cluster, "file", "pull", `${name}/root/marker`, "-", "--project", slug)).out;

const created: { tenantId?: string; clusters: Record<string, string> } = { clusters: {} };
const name = `m-${run}`;
try {
  const all = (await api("GET", "/api/v1/clusters")).body as Array<{ id: string; name: string }>;
  for (const n of [fromName, toName]) {
    const c = all.find((x) => x.name === n);
    if (!c) throw new Error(`cluster ${n} is not enrolled`);
    created.clusters[n] = c.id;
  }
  const from = created.clusters[fromName]!;
  const to = created.clusters[toName]!;
  const me = (await api("GET", "/api/v1/me")).body;
  created.tenantId = (await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: me.id })).body.id;
  for (const c of [from, to]) await api("PUT", `/api/v1/clusters/${c}/tenants/${created.tenantId}`);
  await until("the tenant is placed on both clusters", async () => {
    const st = await Promise.all([from, to].map(async (c) => ((await api("GET", `/api/v1/clusters/${c}/tenants`)).body as Array<{ tenantId: string; status: string }>).find((p) => p.tenantId === created.tenantId)?.status));
    return st.every((s) => s === "ready");
  });

  const launched = await api("POST", `/clusters/${fromName}/1.0/instances?project=${slug}`, {
    name,
    source: { type: "image", alias: "alpine/3.22", server: "https://images.linuxcontainers.org", protocol: "simplestreams" },
    start: true,
  });
  const op = await api("GET", `/clusters/${fromName}${launched.body.operation}/wait?timeout=300`);
  check(op.body.metadata.status === "Success", `launched ${name} on ${fromName}`);
  await inCluster(fromName, "exec", name, "--project", slug, "--", "sh", "-c", "echo one > /root/marker");
  const id = await instanceId(fromName, name);

  // Pre-flight, then a copy the source sends straight to the target.
  const pre = (await api("POST", `/api/v1/instances/${id}/migrations/preflight`, { targetClusterId: to, mode: "copy" })).body;
  check(pre.ok && pre.targetProject === slug && pre.warnings.includes("The copy is not started"), `pre-flight ok, warnings: ${pre.warnings.join("; ")}`);
  const copy = await finish((await api("POST", `/api/v1/instances/${id}/migrations`, { targetClusterId: to, mode: "copy", transport: "direct" })).body.id, "copy");
  check(copy.state === "succeeded" && copy.result?.transport === "direct", `copied with ${copy.result?.transport} (${copy.state} ${copy.error})`);
  check((await marker(toName, name)) === "one", "the copy has the marker");
  const clash = (await api("POST", `/api/v1/instances/${id}/migrations/preflight`, { targetClusterId: to, mode: "move" })).body;
  check(!clash.ok && clash.problems.some((p: string) => p.includes("already exists")), `a second copy under the same name is refused: ${clash.problems[0]}`);

  // A move relayed through the control plane, under another name.
  const moved = `${name}-moved`;
  const move = await finish((await api("POST", `/api/v1/instances/${id}/migrations`, { targetClusterId: to, mode: "move", targetName: moved, transport: "relay" })).body.id, "move");
  check(move.state === "succeeded" && move.result?.transport === "relay", `moved with ${move.result?.transport} (${move.state} ${move.error})`);
  check((await inCluster(fromName, "info", name, "--project", slug)).code !== 0, "the source is gone");
  const state = await inCluster(toName, "list", moved, "--project", slug, "-f", "csv", "-c", "s");
  check(state.out === "RUNNING", `the moved instance runs on ${toName}`);
  check((await inCluster(toName, "exec", moved, "--project", slug, "--", "cat", "/root/marker")).out === "one", "the moved instance has the marker");

  // Cancel a transfer mid-way: enough data that it takes a while.
  await inCluster(toName, "exec", moved, "--project", slug, "--", "sh", "-c", "head -c 400000000 /dev/urandom > /root/big");
  const movedId = await instanceId(toName, moved);
  const back = (await api("POST", `/api/v1/instances/${movedId}/migrations`, { targetClusterId: from, mode: "copy", transport: "relay" })).body.id;
  await until("the transfer is under way", async () => ((await api("GET", `/api/v1/jobs/${back}`)).body as Job).progress.stage === "transferring");
  await api("POST", `/api/v1/jobs/${back}/cancel`);
  const cancelled = await finish(back, "cancel");
  check(cancelled.state === "cancelled", `cancelled (${cancelled.state} ${cancelled.error})`);
  check((await inCluster(fromName, "info", moved, "--project", slug)).code !== 0, "the partial copy was removed");
  check((await inCluster(toName, "list", moved, "--project", slug, "-f", "csv", "-c", "s")).out === "RUNNING", "the source keeps running");

  // Replication back to the first cluster, then a failover to the replica.
  await inCluster(toName, "exec", moved, "--project", slug, "--", "rm", "-f", "/root/big");
  const dr = `${name}-dr`;
  const policy = (await api("POST", "/api/v1/replication-policies", { instanceId: movedId, targetClusterId: from, targetName: dr, intervalS: 60 })).body;
  type Policy = { lastSuccessAt: string | null; lastError: string; lastJobId: string | null; state: string };
  const readPolicy = async () => (await api("GET", `/api/v1/replication-policies/${policy.id}`)).body as Policy;
  const first = await until("the scheduler made the first replica", async () => {
    const pol = await readPolicy();
    if (pol.lastError) throw new Error(`replication failed: ${pol.lastError}`);
    return pol.lastSuccessAt ? pol : undefined;
  });
  const replica = JSON.parse((await inCluster(fromName, "query", `/1.0/instances/${dr}?project=${slug}`)).out);
  check(replica.status === "Stopped" && replica.config["user.incuscloud.replica-of"] === policy.id, "the replica is stopped and tagged with its policy");
  check((await marker(fromName, dr)) === "one", "the replica has the marker");

  await inCluster(toName, "exec", moved, "--project", slug, "--", "sh", "-c", "echo two > /root/marker");
  await finish(first.lastJobId!, "first run");
  const again = await finish((await api("POST", `/api/v1/replication-policies/${policy.id}/run`)).body.id, "refresh");
  check(again.state === "succeeded" && again.result?.refreshed === true, `refreshed (${again.state} ${again.error})`);
  check((await marker(fromName, dr)) === "two", "the refresh brought the change");

  const fo = await finish((await api("POST", `/api/v1/replication-policies/${policy.id}/failover`, { stopSource: true })).body.id, "failover");
  check(fo.state === "succeeded", `failed over (${fo.state} ${fo.error})`);
  check((await inCluster(fromName, "list", dr, "--project", slug, "-f", "csv", "-c", "s")).out === "RUNNING", "the replica runs");
  check((await inCluster(fromName, "exec", dr, "--project", slug, "--", "cat", "/root/marker")).out === "two", "with the latest data");
  check((await inCluster(toName, "list", moved, "--project", slug, "-f", "csv", "-c", "s")).out === "STOPPED", "the source was stopped");
  check((await readPolicy()).state === "failed-over", "the policy has failed over");

  console.log("MOBILITY E2E OK");
} finally {
  for (const [cluster] of Object.entries(created.clusters)) {
    for (const inst of (await inCluster(cluster, "list", "--project", slug, "-f", "csv", "-c", "n")).out.split("\n").filter(Boolean)) await inCluster(cluster, "delete", "-f", inst, "--project", slug);
  }
  if (created.tenantId) {
    for (const c of Object.values(created.clusters)) await api("DELETE", `/api/v1/clusters/${c}/tenants/${created.tenantId}`, undefined, false);
    await api("DELETE", `/api/v1/tenants/${created.tenantId}`, undefined, false);
  }
  for (const cluster of Object.keys(created.clusters)) {
    for (const img of (await inCluster(cluster, "image", "list", "--project", slug, "-f", "csv", "-c", "F")).out.split("\n").filter(Boolean)) await inCluster(cluster, "image", "delete", img, "--project", slug);
    await inCluster(cluster, "project", "delete", slug);
  }
}
