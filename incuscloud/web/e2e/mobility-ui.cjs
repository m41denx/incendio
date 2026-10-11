// The mobility UI in a real browser (Playwright), against scripts/dev.sh with
// two enrolled clusters:
//   node mobility-ui.cjs <base-url> <admin-email> <admin-password> <from> <to> <out-dir>
// Moves an instance with the instance page's dialog, follows the job, creates
// a replication policy, and screenshots the pages. Prints created names last.
const { chromium } = require("playwright");

const [base, email, password, from, to, out = "."] = process.argv.slice(2);
const run = Math.random().toString(36).slice(2, 7);
const slug = `uim-${run}`;
const name = `w-${run}`;
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
  const snap = (n) => page.screenshot({ path: `${out}/${String(++shot).padStart(2, "0")}-${n}.png` });
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

    // Setup through the API (the UI for these is covered by ui-e2e).
    const clusters = await api("GET", "/api/v1/clusters");
    const id = (n) => clusters.find((c) => c.name === n).id;
    const meRow = await api("GET", "/api/v1/me");
    const tenant = await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: meRow.id });
    for (const c of [from, to]) await api("PUT", `/api/v1/clusters/${id(c)}/tenants/${tenant.id}`);
    for (let i = 0; i < 60; i++) {
      const st = await Promise.all([from, to].map(async (c) => (await api("GET", `/api/v1/clusters/${id(c)}/tenants`)).find((p) => p.tenantId === tenant.id)?.status));
      if (st.every((s) => s === "ready")) break;
      await page.waitForTimeout(1000);
    }
    const launch = await api("POST", `/clusters/${from}/1.0/instances?project=${slug}`, { name, source: { type: "image", alias: "alpine/3.22", server: "https://images.linuxcontainers.org", protocol: "simplestreams" }, start: true });
    await api("GET", `/clusters/${from}${launch.operation}/wait?timeout=300`);
    step(`tenant ${slug} on both clusters, ${name} running on ${from}`);

    // Find it in the fleet and open it.
    for (let i = 0; i < 40; i++) {
      await page.goto(`${base}/instances?q=${name}`);
      if (await page.getByRole("link", { name }).waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
      await page.waitForTimeout(2000);
    }
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Move or copy…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Target cluster").selectOption({ label: to });
    await dialog.getByRole("button", { name: "Check" }).click();
    await dialog.getByText(`Ready to move to ${slug} on ${to}`).waitFor();
    check(true, "pre-flight in the dialog");
    await snap("migrate-dialog");
    await dialog.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    await page.getByText("Succeeded").first().waitFor({ timeout: 120000 });
    check(true, "the job page follows the move to Succeeded");
    await snap("job");

    // The moved instance, then a replication policy back to the first cluster.
    for (let i = 0; i < 40; i++) {
      await page.goto(`${base}/instances?q=${name}`);
      const row = page.getByRole("row").filter({ hasText: to }).getByRole("link", { name });
      if (await row.waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
      await page.waitForTimeout(2000);
    }
    await page.getByRole("row").filter({ hasText: to }).getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Replicate…" }).click();
    await page.getByRole("dialog").getByLabel("Target cluster").selectOption({ label: from });
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/replication$/);
    await page.getByRole("row").filter({ hasText: name }).waitFor();
    check(true, "replication policy created from the instance page");
    for (let i = 0; i < 30; i++) {
      if (!(await page.getByRole("row").filter({ hasText: name }).getByText("never").isVisible())) break;
      await page.waitForTimeout(2000);
      await page.reload();
    }
    await page.getByRole("row").filter({ hasText: name }).waitFor();
    await snap("replication");
    await page.goto(`${base}/jobs`);
    await page.getByRole("row").filter({ hasText: "Replication run" }).first().waitFor();
    check(true, "jobs list shows the migration and the replication run");
    await snap("jobs");

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    console.log("MOBILITY UI OK");
  } catch (e) {
    console.log(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e));
    process.exitCode = 1;
  } finally {
    console.log(JSON.stringify({ slug, name }));
    await browser.close();
  }
})();
