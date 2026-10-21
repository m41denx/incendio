// The tenant cloud UI in a real browser (Playwright), against scripts/dev.sh,
// with a tenant left by server/scripts/tenant-cloud-e2e.ts (its CPU quota at 0):
//   node tenant-cloud-ui.cjs <base-url> <admin-email> <admin-password> <tenant-slug> <out-dir>
// The tenant page's quota panel; the Create instance form refused over the
// quota, then (quota raised) creating an instance through it. The instance
// stays for scripts/e2e-cleanup.ts.
const { chromium } = require("playwright");

const [base, email, password, slug, out = "."] = process.argv.slice(2);
let shot = 0;
const t0 = Date.now();
const step = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const check = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
  const snap = (n) => page.screenshot({ path: `${out}/${String(++shot).padStart(2, "0")}-${n}.png`, fullPage: true });
  const api = async (method, path, data) => {
    const r = await page.request.fetch(`${base}${path}`, { method, data, headers: { origin: base } });
    if (r.status() >= 400) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
    return r.status() === 204 ? null : r.json();
  };
  try {
    await page.goto(`${base}/`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth/") && u.origin === new URL(base).origin), page.click("button[type=submit]")]);
    const tenant = (await api("GET", "/api/v1/tenants")).find((t) => t.slug === slug);
    if (!tenant) throw new Error(`tenant ${slug} not found`);

    await page.goto(`${base}/tenants/${tenant.id}`);
    await page.getByRole("heading", { name: "Quota" }).waitFor();
    await page.getByText("Each cluster may use what it already has").waitFor();
    check(true, "quota panel shown");
    await snap("tenant-quota");

    await page.goto(`${base}/instances`);
    await page.getByRole("link", { name: "Create instance" }).click();
    await page.waitForURL(/\/instances\/new/);
    await page.getByLabel("Tenant").selectOption(tenant.id);
    await page.getByLabel("Name").fill("w-ui");
    await page.getByLabel("Image").selectOption("alpine/3.22");
    await page.getByLabel("Memory (GiB)").fill("0.25");
    await page.getByLabel("Disk (GiB)").fill("1");
    await page.getByText(/^Left in the tenant's quota/).waitFor();
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByText(/Over the tenant's quota: cpu/).waitFor();
    check(true, "over quota: the API's reason is shown");
    await snap("create-refused");

    await api("PATCH", `/api/v1/tenants/${tenant.id}`, { quotas: { instances: 3, cpu: 4, memory: 2, disk: 20 } });
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    await page.getByText(/^(Succeeded|Failed)$/).first().waitFor({ timeout: 240000 });
    check((await page.getByText("Succeeded", { exact: true }).count()) > 0, "the create job succeeded");
    await snap("create-job");
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    console.log("TENANT CLOUD UI OK");
  } catch (e) {
    console.log(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e));
    await snap("failure").catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
