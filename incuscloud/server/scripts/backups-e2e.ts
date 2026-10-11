// Backups against a real S3 (MinIO) and two real clusters, end to end
// (scripts/dev.sh running, both clusters enrolled, .dev/s3.env; see README "Backups"):
//   bun scripts/backups-e2e.ts [from=cluster-b] [to=cluster-c] [s3=http://10.133.241.72:9000]
// Backs up through the control plane and directly, runs a policy past its
// retention, restores to the other cluster, and handles a lost object.
import { readFileSync } from "node:fs";
import { S3Client } from "bun";
import { TestBrowser } from "../src/test/browser.ts";

const [fromName = "cluster-b", toName = "cluster-c", endpoint = "http://10.133.241.72:9000"] = process.argv.slice(2);
const dev = new URL("../../.dev/", import.meta.url);
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const run = crypto.randomUUID().slice(0, 6);
const slug = `bk-${run}`;
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

const s3env = Object.fromEntries(
  readFileSync(new URL("s3.env", dev), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("=") as [string, string]),
);
const bucket = "incuscloud";
const s3 = new S3Client({ endpoint, bucket, accessKeyId: s3env.S3_ACCESS_KEY, secretAccessKey: s3env.S3_SECRET_KEY });

const browser = new TestBrowser(readFileSync(new URL("tls/ca.crt", dev), "utf8"));
const login = await browser.go(`${base}/auth/start?return_to=/api/v1/me`);
await browser.submit(login, { email: "admin@incuscloud.dev", password: readFileSync(new URL("admin-password", dev), "utf8").trim() });
const api = async (method: string, path: string, body?: unknown, ok = true) => {
  const r = await browser.api(base, method, path, body);
  if (ok && r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};
const inCluster = async (cluster: string, ...args: string[]) => {
  const p = Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim(), err: err.trim() };
};
type Job = { id: string; state: string; error: string; result: Record<string, unknown> | null };
const finish = (id: string, what: string) =>
  until(`${what}: job finished`, async () => {
    const j = (await api("GET", `/api/v1/jobs/${id}`)).body as Job;
    return ["succeeded", "failed", "cancelled"].includes(j.state) ? j : undefined;
  });
type Backup = { id: string; objectKey: string; state: string; sizeBytes: number | null; transport: string; policyId: string | null };

const created: { tenantId?: string; targetId?: string; clusters: Record<string, string> } = { clusters: {} };
const name = `b-${run}`;
try {
  const all = (await api("GET", "/api/v1/clusters")).body as Array<{ id: string; name: string }>;
  for (const n of [fromName, toName]) {
    const c = all.find((x) => x.name === n);
    if (!c) throw new Error(`cluster ${n} is not enrolled`);
    created.clusters[n] = c.id;
  }
  const from = created.clusters[fromName]!;
  const to = created.clusters[toName]!;

  // A target, checked.
  created.targetId = (await api("POST", "/api/v1/backup-targets", { name: `minio-${run}`, endpoint, bucket, prefix: `e2e-${run}`, accessKeyId: s3env.S3_ACCESS_KEY, secretKey: s3env.S3_SECRET_KEY })).body.id;
  const targetId = created.targetId!;
  check((await api("POST", `/api/v1/backup-targets/${targetId}/check`)).body.ok === true, "the target answers");
  const bad = (await api("POST", "/api/v1/backup-targets", { name: `bad-${run}`, endpoint, bucket, accessKeyId: "nobody", secretKey: "wrong" })).body.id;
  const badCheck = (await api("POST", `/api/v1/backup-targets/${bad}/check`)).body;
  check(badCheck.ok === false && /InvalidAccessKeyId/.test(badCheck.error), `wrong keys are reported: ${badCheck.error}`);
  await api("DELETE", `/api/v1/backup-targets/${bad}`);

  // A tenant on both clusters, an instance with a marker.
  const me = (await api("GET", "/api/v1/me")).body;
  created.tenantId = (await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: me.id })).body.id;
  for (const c of [from, to]) await api("PUT", `/api/v1/clusters/${c}/tenants/${created.tenantId}`);
  await until("the tenant is placed on both clusters", async () => {
    const st = await Promise.all([from, to].map(async (c) => ((await api("GET", `/api/v1/clusters/${c}/tenants`)).body as Array<{ tenantId: string; status: string }>).find((p) => p.tenantId === created.tenantId)?.status));
    return st.every((s) => s === "ready");
  });
  const projectConfig = JSON.parse((await inCluster(fromName, "query", `/1.0/projects/${slug}`)).out).config;
  check(projectConfig["restricted.backups"] === "allow", "the tenant project allows backups");
  const launched = await api("POST", `/clusters/${fromName}/1.0/instances?project=${slug}`, { name, source: { type: "image", alias: "alpine/3.22", server: "https://images.linuxcontainers.org", protocol: "simplestreams" }, start: true });
  await api("GET", `/clusters/${fromName}${launched.body.operation}/wait?timeout=300`);
  await inCluster(fromName, "exec", name, "--project", slug, "--", "sh", "-c", "echo one > /root/marker");
  const id = await until(`${name} is in the inventory`, async () => ((await api("GET", `/api/v1/instances?q=${name}`)).body.items as Array<{ id: string; name: string }>).find((i) => i.name === name)?.id);

  // Through the control plane, then uploaded by the cluster itself.
  const relay = await finish((await api("POST", `/api/v1/instances/${id}/backups`, { targetId, transport: "relay" })).body.id, "relay backup");
  check(relay.state === "succeeded" && relay.result?.transport === "relay", `relayed (${relay.state} ${relay.error})`);
  const direct = await finish((await api("POST", `/api/v1/instances/${id}/backups`, { targetId, transport: "direct" })).body.id, "direct backup");
  check(direct.state === "succeeded" && direct.result?.transport === "direct", `uploaded by the cluster (${direct.state} ${direct.error})`);
  const listed = (await api("GET", `/api/v1/backups?instance=${id}`)).body as Backup[];
  check(listed.length === 2 && listed.every((b) => b.state === "ready" && (b.sizeBytes ?? 0) > 1000), `two ready backups: ${listed.map((b) => b.sizeBytes).join(", ")} bytes`);
  for (const b of listed) check((await s3.file(b.objectKey).exists()) === true, `object ${b.objectKey} is in the bucket`);
  check((await inCluster(fromName, "query", `/1.0/instances/${name}/backups?project=${slug}`)).out === "[]", "no backup is left on the cluster");

  // A policy past its retention.
  const policy = (await api("POST", "/api/v1/backup-policies", { instanceId: id, targetId, keep: 2, intervalS: 86400 })).body;
  await until("the scheduler ran the policy", async () => ((await api("GET", `/api/v1/backup-policies/${policy.id}`)).body.lastSuccessAt ? true : undefined));
  await inCluster(fromName, "exec", name, "--project", slug, "--", "sh", "-c", "echo two > /root/marker");
  for (let i = 0; i < 2; i++) {
    const j = await finish((await api("POST", `/api/v1/backup-policies/${policy.id}/run`)).body.id, `policy run ${i + 2}`);
    check(j.state === "succeeded", `policy run ${i + 2} (${j.error})`);
  }
  const kept = (await api("GET", `/api/v1/backups?policy=${policy.id}`)).body as Backup[];
  check(kept.length === 2, `the policy keeps 2 of 3 (${kept.length})`);
  const objects = (await s3.list({ prefix: `e2e-${run}/` })).contents?.length ?? 0;
  check(objects === 4, `the bucket holds 4 objects: 2 manual + 2 kept (${objects})`);

  // Restore the newest to the other cluster, started.
  const latest = kept[0]!;
  const restored = `${name}-r`;
  const rj = await finish((await api("POST", `/api/v1/backups/${latest.id}/restore`, { targetClusterId: to, targetName: restored, start: true })).body.id, "restore");
  check(rj.state === "succeeded", `restored (${rj.state} ${rj.error})`);
  check((await inCluster(toName, "list", restored, "--project", slug, "-f", "csv", "-c", "s")).out === "RUNNING", `${restored} runs on ${toName}`);
  check((await inCluster(toName, "exec", restored, "--project", slug, "--", "cat", "/root/marker")).out === "two", "with the newest data");
  // The tenant project is restricted: the restore went through the staging project (P7 restore-job).
  check((await inCluster(toName, "exec", restored, "--project", slug, "--", "stat", "-c", "%u:%g", "/etc/passwd", "/root/marker")).out === "0:0\n0:0", "files are owned by root inside, not shifted twice");
  check((await inCluster(toName, "list", "--project", "incuscloud-restore", "-f", "csv", "-c", "n")).out === "", "nothing is left in the staging project");
  const tags = JSON.parse((await inCluster(toName, "query", `/1.0/instances/${restored}?project=${slug}`)).out).config;
  check(tags["user.incuscloud.restored-from"] === latest.id, "tagged with its backup");
  const clash = await finish((await api("POST", `/api/v1/backups/${latest.id}/restore`, { targetClusterId: from })).body.id, "restore over the original");
  check(clash.state === "failed" && /already exists/.test(clash.error), `the original is not overwritten: ${clash.error}`);

  // An object deleted behind our back.
  const lost = listed[0]!;
  await s3.file(lost.objectKey).delete();
  const lj = await finish((await api("POST", `/api/v1/backups/${lost.id}/restore`, { targetClusterId: to, targetName: `${name}-lost` })).body.id, "restore of a lost object");
  check(lj.state === "failed" && /not in its target any more/.test(lj.error), `a lost object is reported: ${lj.error}`);

  // Deleting backups removes their objects.
  await api("DELETE", `/api/v1/backup-policies/${policy.id}`);
  for (const b of (await api("GET", `/api/v1/backups?instance=${id}`)).body as Backup[]) await api("DELETE", `/api/v1/backups/${b.id}`);
  check(((await s3.list({ prefix: `e2e-${run}/` })).contents?.length ?? 0) === 0, "deleting the backups emptied the prefix");

  console.log("BACKUPS E2E OK");
} finally {
  for (const [cluster] of Object.entries(created.clusters)) {
    for (const inst of (await inCluster(cluster, "list", "--project", slug, "-f", "csv", "-c", "n")).out.split("\n").filter(Boolean)) await inCluster(cluster, "delete", "-f", inst, "--project", slug);
  }
  if (created.tenantId) {
    for (const c of Object.values(created.clusters)) await api("DELETE", `/api/v1/clusters/${c}/tenants/${created.tenantId}`, undefined, false);
    for (const b of ((await api("GET", `/api/v1/backups?tenant=${created.tenantId}`, undefined, false)).body ?? []) as Backup[]) await api("DELETE", `/api/v1/backups/${b.id}`, undefined, false);
    await api("DELETE", `/api/v1/tenants/${created.tenantId}`, undefined, false);
  }
  for (const cluster of Object.keys(created.clusters)) {
    for (const img of (await inCluster(cluster, "image", "list", "--project", slug, "-f", "csv", "-c", "F")).out.split("\n").filter(Boolean)) await inCluster(cluster, "image", "delete", img, "--project", slug);
    await inCluster(cluster, "project", "delete", slug);
  }
  if (created.targetId) await api("DELETE", `/api/v1/backup-targets/${created.targetId}`, undefined, false);
}
