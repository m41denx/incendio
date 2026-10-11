// The backups UI in a real browser (Playwright), against scripts/dev.sh with
// two enrolled clusters and an S3 endpoint:
//   S3_ACCESS_KEY=… S3_SECRET_KEY=… node backups-ui.cjs <base-url> <admin-email> <admin-password> <from> <to> <s3-endpoint> <out-dir>
// Adds a target through its form, backs an instance up from its page, sets a
// schedule, restores to the other cluster, and screenshots the pages. Removes
// what it made (backups, target) at the end; tenants and projects go with
// scripts/e2e-cleanup.ts uib-.
const { chromium } = require("playwright");

const [base, email, password, from, to, endpoint, out = "."] = process.argv.slice(2);
const run = Math.random().toString(36).slice(2, 7);
const slug = `uib-${run}`;
const name = `w-${run}`;
const targetName = `minio-${run}`;
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
  const jobDone = async () => {
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    await page.getByText(/^(Succeeded|Failed)$/).first().waitFor({ timeout: 240000 });
    const failed = await page.getByText("Failed", { exact: true }).count();
    return failed === 0;
  };
  let tenantId;
  try {
    await page.goto(`${base}/`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth/") && u.origin === new URL(base).origin), page.click("button[type=submit]")]);

    // A target, through its form.
    await page.goto(`${base}/backup-targets`);
    await page.getByRole("button", { name: "Add target" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Name").fill(targetName);
    await form.getByLabel("Endpoint").fill(endpoint);
    await form.getByLabel("Bucket").fill("incuscloud");
    await form.getByLabel("Prefix").fill(`ui-${run}`);
    await form.getByLabel("Access key ID").fill(process.env.S3_ACCESS_KEY);
    await form.getByLabel("Secret key").fill(process.env.S3_SECRET_KEY);
    await form.getByRole("button", { name: "Add" }).click();
    const row = page.getByRole("row").filter({ hasText: targetName });
    await row.waitFor();
    await row.getByRole("button", { name: "Check" }).click();
    await page.getByText(`${targetName} answers.`).waitFor();
    check(true, "target added and checked through the UI");
    await snap("targets");

    // Setup through the API (covered by ui-e2e).
    const clusters = await api("GET", "/api/v1/clusters");
    const id = (n) => clusters.find((c) => c.name === n).id;
    const meRow = await api("GET", "/api/v1/me");
    tenantId = (await api("POST", "/api/v1/tenants", { slug, name: slug, ownerId: meRow.id })).id;
    for (const c of [from, to]) await api("PUT", `/api/v1/clusters/${id(c)}/tenants/${tenantId}`);
    for (let i = 0; i < 60; i++) {
      const st = await Promise.all([from, to].map(async (c) => (await api("GET", `/api/v1/clusters/${id(c)}/tenants`)).find((p) => p.tenantId === tenantId)?.status));
      if (st.every((s) => s === "ready")) break;
      await page.waitForTimeout(1000);
    }
    const launch = await api("POST", `/clusters/${from}/1.0/instances?project=${slug}`, { name, source: { type: "image", alias: "alpine/3.22", server: "https://images.linuxcontainers.org", protocol: "simplestreams" }, start: true });
    await api("GET", `/clusters/${from}${launch.operation}/wait?timeout=300`);
    step(`${name} running on ${from}`);
    for (let i = 0; i < 40; i++) {
      await page.goto(`${base}/instances?q=${name}`);
      if (await page.getByRole("link", { name }).waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
      await page.waitForTimeout(2000);
    }
    await page.getByRole("link", { name }).click();
    const instanceUrl = page.url();

    // Back up now.
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Back up now…" }).click();
    await page.getByRole("dialog").getByLabel("Target").selectOption({ label: targetName });
    await snap("backup-now");
    await page.getByRole("dialog").getByRole("button", { name: "Back up" }).click();
    check(await jobDone(), "backup job succeeded");
    await snap("backup-job");

    // A schedule; the scheduler makes the first run.
    await page.goto(instanceUrl);
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Backup schedule…" }).click();
    await page.getByRole("dialog").getByLabel("Target").selectOption({ label: targetName });
    await page.getByRole("dialog").getByLabel("Keep").fill("3");
    await page.getByRole("dialog").getByRole("button", { name: "Create schedule" }).click();
    await page.waitForURL(/\/backups\?instance=/);
    for (let i = 0; i < 30; i++) {
      // The manual backup is always listed: once it is, the list has loaded.
      await page.getByRole("row").filter({ hasText: "by hand" }).first().waitFor();
      if ((await page.getByRole("row").filter({ hasText: "scheduled" }).count()) > 0 && (await page.getByText("Creating", { exact: true }).count()) === 0) break;
      await page.waitForTimeout(2000);
      await page.reload();
    }
    check((await page.getByRole("row").filter({ hasText: "scheduled" }).count()) > 0, "the schedule made a backup");
    await snap("backups");

    // Restore the manual one to the other cluster.
    await page.getByRole("row").filter({ hasText: "by hand" }).getByRole("button", { name: "Restore…" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Cluster").selectOption({ label: to });
    await dlg.getByLabel("Start it afterwards").check({ force: true });
    await snap("restore");
    await dlg.getByRole("button", { name: "Restore" }).click();
    check(await jobDone(), "restore job succeeded");
    await snap("restore-job");

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    console.log("BACKUPS UI OK");
  } catch (e) {
    console.log(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e));
    await snap("failure").catch(() => {});
    process.exitCode = 1;
  } finally {
    // Backups and schedules of this tenant, then the target.
    try {
      if (tenantId) {
        for (const p of await api("GET", "/api/v1/backup-policies")) if (p.tenantId === tenantId) await api("DELETE", `/api/v1/backup-policies/${p.id}`);
        for (const b of await api("GET", `/api/v1/backups?tenant=${tenantId}`)) await api("DELETE", `/api/v1/backups/${b.id}`).catch(() => {});
      }
      const t = (await api("GET", "/api/v1/backup-targets")).find((x) => x.name === targetName);
      if (t) await api("DELETE", `/api/v1/backup-targets/${t.id}`);
    } catch (e) {
      console.log(`cleanup: ${e.message}`);
    }
    console.log(JSON.stringify({ slug, name }));
    await browser.close();
  }
})();
