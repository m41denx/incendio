// Balancing against a real two-member cluster (scripts/dev.sh running, the cluster enrolled):
//   IC_PUBLIC_URL=… bun scripts/balancing-e2e.ts [cluster=cluster-d]
// Places a tenant, crowds one member, then: a dry run, a run (a running
// container moves with a restart), placement hints (a pin, anti-affinity),
// evacuating and restoring a member, and the suggestions endpoint. Leaves
// the tenant for scripts/e2e-cleanup.ts bl- <cluster>.
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";

const [clusterName = "cluster-d"] = process.argv.slice(2);
const dev = new URL("../../.dev/", import.meta.url);
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const run = crypto.randomUUID().slice(0, 5);
const slug = `bl-${run}`;
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
const api = async (method: string, path: string, body?: unknown) => {
  const r = await browser.api(base, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
/** `incus` on the cluster's first member (the dev clusters are containers on this host). */
const incus = async (...args: string[]) => {
  const p = Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", "d1", "--", "incus", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`incus ${args.join(" ")}: ${err.trim()}`);
  return out.trim();
};
/** name → [member, status] in the tenant's project. */
const where = async () => Object.fromEntries((await incus("list", "--project", slug, "-f", "csv", "-c", "nLs")).split("\n").filter(Boolean).map((l) => { const [n, loc, st] = l.split(","); return [n!, [loc!, st!]]; }));
type Job = { id: string; state: string; error: string; result: Record<string, unknown> | null };
const finish = (id: string, what: string) =>
  until(`${what}: job finished`, async () => {
    const j = (await api("GET", `/api/v1/jobs/${id}`)) as Job;
    return ["succeeded", "failed", "cancelled"].includes(j.state) ? j : undefined;
  });
type Move = { name: string; from: string; to: string; reason: string; outcome?: string; detail?: string };
const show = (ms: Move[]) => ms.map((m) => `${m.name} ${m.from}→${m.to} (${m.reason}${m.outcome ? `, ${m.outcome}` : ""}${m.detail ? `: ${m.detail}` : ""})`).join("; ") || "none";

const n = (x: string) => `${x}-${run}`;
let clusterId = "";
const POLICY = { enabled: false, intervalS: 3600, method: "memory", mode: "assigned", balanciness: 10, maxMoves: 5, allowRestart: true, excludeMembers: [], excludeProjects: [] };
try {
  const c = ((await api("GET", "/api/v1/clusters")) as Array<{ id: string; name: string }>).find((x) => x.name === clusterName);
  if (!c) throw new Error(`cluster ${clusterName} is not enrolled`);
  clusterId = c.id;
  const members = ((await api("GET", `/api/v1/clusters/${clusterId}/inventory`)) as { members: Array<{ name: string; status: string }> }).members;
  check(members.length === 2 && members.every((m) => m.status === "Online"), `two online members: ${members.map((m) => m.name).join(", ")}`);

  // A tenant on the cluster; four 512 MiB instances crowded on d1, one running.
  const me = await api("GET", "/api/v1/me");
  const tenantId = (await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: me.id })).id;
  await api("PUT", `/api/v1/clusters/${clusterId}/tenants/${tenantId}`);
  await until("the tenant is placed", async () => ((await api("GET", `/api/v1/clusters/${clusterId}/tenants`)) as Array<{ tenantId: string; status: string }>).find((p) => p.tenantId === tenantId)?.status === "ready");
  await incus("launch", "images:alpine/3.22", n("a"), "--project", slug, "--target", "d1", "-c", "limits.memory=512MiB");
  for (const x of ["b", "c", "d"]) await incus("init", "images:alpine/3.22", n(x), "--project", slug, "--target", "d1", "-c", "limits.memory=512MiB");
  check(Object.values(await where()).every(([m]) => m === "d1"), "four instances on d1");

  // A dry run moves nothing.
  await api("PUT", `/api/v1/clusters/${clusterId}/balancing`, POLICY);
  const plan = (await api("POST", `/api/v1/clusters/${clusterId}/balancing/plan`, {})) as { before: number; after: number; moves: Move[]; notes: string[] };
  step(`plan: spread ${plan.before.toFixed(1)} → ${plan.after.toFixed(1)}; ${show(plan.moves)}; notes: ${plan.notes.join(" | ") || "none"}`);
  check(plan.moves.length === 2 && plan.moves.every((m) => m.from === "d1" && m.to === "d2") && plan.after < plan.before, "the plan moves two of four to d2");
  check(Object.values(await where()).every(([m]) => m === "d1"), "a dry run moves nothing");

  // The run: the running one is stopped, moved and started.
  let job = await finish((await api("POST", `/api/v1/clusters/${clusterId}/balancing/run`)).id, "rebalance");
  let moves = (job.result?.moves ?? []) as Move[];
  step(`run: ${show(moves)}`);
  check(job.state === "succeeded" && moves.length === 2 && moves.every((m) => m.outcome === "moved"), "both moves done");
  let w = await where();
  check(Object.values(w).filter(([m]) => m === "d2").length === 2, "two instances on each member");
  check(w[n("a")]![1] === "RUNNING", `the running instance is running again (on ${w[n("a")]![0]})`);

  // Hints: pin one moved instance back to d1; keep c and d (both on d1) apart.
  const onD2 = Object.entries(w).filter(([, [m]]) => m === "d2").map(([k]) => k);
  const pinned = onD2.find((k) => k !== n("a")) ?? onD2[0]!;
  const [x, y] = Object.entries(w).filter(([, [m]]) => m === "d1").map(([k]) => k) as [string, string];
  await incus("config", "set", pinned, "user.incuscloud.pin=d1", "--project", slug);
  for (const k of [x, y]) await incus("config", "set", k, "user.incuscloud.anti-affinity=ha", "--project", slug);
  job = await finish((await api("POST", `/api/v1/clusters/${clusterId}/balancing/run`)).id, "rebalance with hints");
  moves = (job.result?.moves ?? []) as Move[];
  step(`run: ${show(moves)}`);
  w = await where();
  check(w[pinned]![0] === "d1" && moves.some((m) => m.name === pinned && m.reason === "pin"), `${pinned} went to its pinned member`);
  check(w[x]![0] !== w[y]![0] && moves.some((m) => m.reason === "anti-affinity"), `${x} and ${y} are apart`);

  // A member in maintenance and back.
  job = await finish((await api("POST", `/api/v1/clusters/${clusterId}/members/d2/evacuate`, {})).id, "evacuate d2");
  check(job.state === "succeeded", `evacuation succeeded${job.error ? `: ${job.error}` : ""}`);
  const state = async () => (await incus("cluster", "list", "-f", "csv", "-c", "ns")).split("\n").find((l) => l.startsWith("d2,"))?.split(",")[1];
  check((await state()) === "EVACUATED", "d2 is evacuated");
  w = await where();
  step(`after evacuation: ${JSON.stringify(w)}`);
  check(Object.values(w).every(([m, s]) => m === "d1" || s === "STOPPED"), "nothing runs on d2");
  const evacPlan = (await api("POST", `/api/v1/clusters/${clusterId}/balancing/plan`, {})) as { moves: Move[] };
  check(evacPlan.moves.every((m) => m.to !== "d2" && m.from !== "d2"), "an evacuated member is no target");
  job = await finish((await api("POST", `/api/v1/clusters/${clusterId}/members/d2/restore`)).id, "restore d2");
  check(job.state === "succeeded" && (await state()) === "ONLINE", "d2 is back online");
  step(`after restore: ${JSON.stringify(await where())}`);

  // Suggestions answer (tenants on one cluster get none).
  const sugg = (await api("GET", "/api/v1/balancing/suggestions")) as Array<{ tenantSlug: string }>;
  check(Array.isArray(sugg) && !sugg.some((s) => s.tenantSlug === slug), `suggestions answer (${sugg.length}), none for a single-cluster tenant`);
  console.log("BALANCING E2E OK");
} catch (e) {
  console.log(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  if (clusterId) await api("PUT", `/api/v1/clusters/${clusterId}/balancing`, POLICY).catch(() => {});
  console.log(JSON.stringify({ slug }));
}
