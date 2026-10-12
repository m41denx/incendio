// Removes what the end-to-end scripts left behind on the dev setup: tenants
// and users whose slug / email starts with a prefix, their placements, and
// their projects on the dev clusters (as the host's Incus admin).
//   bun scripts/e2e-cleanup.ts [prefix=ui-] [cluster-instance…=cluster-b cluster-c]
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";

const prefix = process.argv[2] ?? "ui-";
const instances = process.argv.length > 3 ? process.argv.slice(3) : ["cluster-b", "cluster-c"];
const dev = new URL("../../.dev/", import.meta.url);
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const b = new TestBrowser(readFileSync(new URL("tls/ca.crt", dev), "utf8"));
const login = await b.go(`${base}/auth/start?return_to=/api/v1/me`);
await b.submit(login, { email: "admin@incuscloud.dev", password: readFileSync(new URL("admin-password", dev), "utf8").trim() });

const api = async (method: string, path: string) => {
  const r = await b.api(base, method, path);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
let instance = instances[0]!;
const incus = async (...args: string[]) => {
  const p = Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", instance, "--", "incus", ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: await p.exited, out: await new Response(p.stdout).text() };
};

const k8s = ((await api("GET", "/api/v1/kubernetes/versions")) as { enabled: boolean }).enabled;
for (const t of (await api("GET", "/api/v1/tenants")) as Array<{ id: string; slug: string }>) {
  if (!t.slug.startsWith(prefix)) continue;
  // Kubernetes clusters first: a tenant with some is not removed from their Incus cluster.
  if (k8s) {
    const list = () => api("GET", `/api/v1/kubernetes?tenant=${t.id}`) as Promise<Array<{ id: string; name: string; status: string }>>;
    for (const c of await list()) {
      const r = await b.api(base, "DELETE", `/api/v1/kubernetes/${c.id}`);
      console.log(`kubernetes ${t.slug}/${c.name}: delete ${r.status === 202 ? "started" : `→ ${r.status}`}`);
    }
    for (let i = 0; (await list()).length && i < 200; i++) await Bun.sleep(3000);
  }
  for (const p of (await api("GET", `/api/v1/tenants/${t.id}/placements`)) as Array<{ clusterId: string }>) await api("DELETE", `/api/v1/clusters/${p.clusterId}/tenants/${t.id}`);
  await api("DELETE", `/api/v1/tenants/${t.id}`);
  console.log(`tenant ${t.slug} deleted`);
}
for (const u of (await api("GET", "/api/v1/users")) as Array<{ id: string; email: string }>) {
  if (!u.email.startsWith(prefix)) continue;
  await api("DELETE", `/api/v1/users/${u.id}`);
  console.log(`user ${u.email} deleted`);
}
// Projects are never deleted by the reconciler; remove the test ones (and their images) directly, on every dev cluster.
for (instance of instances) {
  for (const project of (await incus("project", "list", "-f", "csv", "-c", "n")).out.split("\n").map((l) => l.replace(/ \(current\)$/, "").trim())) {
    if (!project.startsWith(prefix)) continue;
    for (const inst of (await incus("list", "--project", project, "-f", "csv", "-c", "n")).out.split("\n").filter(Boolean)) await incus("delete", "-f", inst, "--project", project);
    for (const img of (await incus("image", "list", "--project", project, "-f", "csv", "-c", "F")).out.split("\n").filter(Boolean)) await incus("image", "delete", img, "--project", project);
    const r = await incus("project", "delete", project);
    console.log(`${instance}: project ${project} ${r.code === 0 ? "deleted" : "NOT deleted (not empty?)"}`);
  }
}
