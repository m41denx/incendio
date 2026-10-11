// The fleet inventory on a real cluster, end to end (scripts/dev.sh running,
// the cluster enrolled; IC_INVENTORY_INTERVAL is 15 s in dev):
//   bun scripts/fleet-e2e.ts [cluster-name]
// An instance launched in a tenant's project shows up in the global search
// with its address and CPU history, for the tenant's member and the platform,
// and not for another tenant's member.
import { readFileSync } from "node:fs";
import { TestBrowser } from "../src/test/browser.ts";

const cluster = process.argv[2] ?? "cluster-b";
const dev = new URL("../../.dev/", import.meta.url);
const ca = readFileSync(new URL("tls/ca.crt", dev), "utf8");
const base = process.env.IC_PUBLIC_URL ?? "https://127.0.0.1:7443";
const run = crypto.randomUUID().slice(0, 6);
const t0 = performance.now();
const step = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 120_000): Promise<T> {
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

const signIn = async (email: string, password: string) => {
  const b = new TestBrowser(ca);
  const me = await b.submit(await b.go(`${base}/auth/start?return_to=/api/v1/me`), { email, password });
  if (me.res.status !== 200) throw new Error(`sign-in as ${email} failed: ${me.res.status}`);
  return async (method: string, path: string, body?: unknown, ok = true) => {
    const r = await b.api(base, method, path, body);
    if (ok && r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
};

type Instance = { id: string; name: string; status: string; addresses: string[]; tenantSlug: string | null; cpuCores: number | null };
const created: { users: string[]; tenants: string[]; clusterId?: string } = { users: [], tenants: [] };
const slugs = [`fleet-${run}`, `fleet-${run}-x`];
const admin = await signIn("admin@incuscloud.dev", readFileSync(new URL("admin-password", dev), "utf8").trim());
const gw = (method: string, path: string, body?: unknown) => admin(method, `/clusters/${cluster}${path}`, body);
const waitOp = async (r: { body: { operation?: string } }) => {
  const op = await gw("GET", `${r.body.operation}/wait?timeout=300`);
  if (op.body.metadata.status !== "Success") throw new Error(`operation ${op.body.metadata.status}: ${op.body.metadata.err}`);
};

try {
  const c = (await admin("GET", "/api/v1/clusters")).body.find((x: { name: string }) => x.name === cluster);
  if (!c) throw new Error(`cluster ${cluster} is not enrolled`);
  created.clusterId = c.id;
  const people = [];
  for (const slug of slugs) {
    const password = crypto.randomUUID();
    const email = `${slug}@example.com`;
    const user = (await admin("POST", "/api/v1/users", { email, name: slug, password })).body;
    created.users.push(user.id);
    const tenant = (await admin("POST", "/api/v1/tenants", { slug, name: slug, ownerId: user.id })).body;
    created.tenants.push(tenant.id);
    await admin("PUT", `/api/v1/clusters/${c.id}/tenants/${tenant.id}`);
    people.push({ email, password, tenant });
  }
  await until("both tenants placed", async () => {
    const placed = (await admin("GET", `/api/v1/clusters/${c.id}/tenants`)).body as Array<{ tenantId: string; status: string; statusMessage: string }>;
    const mine = placed.filter((p) => created.tenants.includes(p.tenantId));
    const failed = mine.find((p) => p.status === "error");
    if (failed) throw new Error(`placement error: ${failed.statusMessage}`);
    return mine.length === 2 && mine.every((p) => p.status === "ready");
  });

  const project = slugs[0]!;
  const name = `f-${run}`;
  await waitOp(
    await gw("POST", `/1.0/instances?project=${project}`, {
      name,
      source: { type: "image", alias: "alpine/3.22", server: "https://images.linuxcontainers.org", protocol: "simplestreams" },
      start: true,
    }),
  );
  step(`launched ${project}/${name} through the gateway`);

  const found = await until("the instance is in the inventory, running, with an IPv4 address", async () => {
    const r = await admin("GET", `/api/v1/instances?q=${name}`);
    const i = (r.body.items as Instance[]).find((x) => x.name === name);
    return i && i.status === "Running" && i.addresses.some((a) => !a.includes(":")) ? i : undefined;
  });
  check(found.tenantSlug === project, `listed under tenant ${found.tenantSlug}`);
  const ip = found.addresses.find((a) => !a.includes(":"))!;

  const member = await signIn(people[0]!.email, people[0]!.password);
  const byIp = (await member("GET", `/api/v1/instances?q=${encodeURIComponent(ip)}`)).body;
  check(byIp.total === 1 && byIp.items[0].name === name, `the member finds it by address ${ip}`);
  check((await member("GET", "/api/v1/fleet/summary")).body.instances.total === 1, "the member's summary counts it");
  check((await member("GET", `/api/v1/clusters/${c.id}/inventory`, undefined, false)).status === 403, "the member gets no cluster inventory");

  const stranger = await signIn(people[1]!.email, people[1]!.password);
  check((await stranger("GET", `/api/v1/instances?q=${encodeURIComponent(ip)}`)).body.total === 0, "another tenant's member does not find it");
  check((await stranger("GET", `/api/v1/instances/${found.id}`, undefined, false)).status === 404, "and gets 404 for it");

  const samples = await until("two passes later it has a CPU reading", async () => {
    const s = (await member("GET", `/api/v1/instances/${found.id}/metrics?hours=1`)).body.samples as Array<{ cpuCores: number | null }>;
    return s.some((x) => x.cpuCores != null) ? s : undefined;
  });
  check(samples.length >= 2, `${samples.length} samples`);

  const inv = (await admin("GET", `/api/v1/clusters/${c.id}/inventory`)).body;
  check(inv.inventoryError === "" && inv.members.length >= 1 && inv.instances.total >= 1, `cluster inventory: ${inv.members.length} member(s), ${inv.pools.length} pool(s), ${inv.instances.total} instance(s)`);

  await waitOp(await gw("DELETE", `/1.0/instances/${name}?project=${project}`).catch(async () => {
    await waitOp(await gw("PUT", `/1.0/instances/${name}/state?project=${project}`, { action: "stop", force: true }));
    return gw("DELETE", `/1.0/instances/${name}?project=${project}`);
  }));
  await until("the deleted instance leaves the inventory", async () => (await admin("GET", `/api/v1/instances?q=${name}`)).body.total === 0);
  console.log("FLEET E2E OK");
} finally {
  const inCluster = (...args: string[]) => Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", ...args], { stdout: "ignore", stderr: "ignore" }).exited;
  for (const id of created.tenants) {
    if (created.clusterId) await admin("DELETE", `/api/v1/clusters/${created.clusterId}/tenants/${id}`, undefined, false);
    await admin("DELETE", `/api/v1/tenants/${id}`, undefined, false);
  }
  for (const id of created.users) await admin("DELETE", `/api/v1/users/${id}`, undefined, false);
  for (const slug of slugs) {
    await inCluster("delete", "-f", `f-${run}`, "--project", slug);
    const imgs = await new Response(Bun.spawn(["sudo", "incus", "exec", "--project", "incuscloud-dev", cluster, "--", "incus", "image", "list", "--project", slug, "-f", "csv", "-c", "F"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
    for (const img of imgs.split("\n").filter(Boolean)) await inCluster("image", "delete", img, "--project", slug);
    await inCluster("project", "delete", slug);
  }
}
