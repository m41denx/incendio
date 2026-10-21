// The platform UI end to end in a real browser (Playwright), against
// scripts/dev.sh with an enrolled cluster:
//   node ui-e2e.cjs <base-url> <admin-email> <admin-password> <cluster-name> <out-dir>
// Signs in through the real flow, creates a user and a tenant, adds the user,
// places the tenant on the cluster and waits for it to be ready, creates a
// tenant service account, opens the cluster console, signs out, then checks
// what the new user (a tenant member) sees. Prints the created ids as JSON on
// the last line for cleanup.
const { chromium } = require("playwright");

const [base, adminEmail, adminPassword, clusterName, out = "."] = process.argv.slice(2);
const run = Math.random().toString(36).slice(2, 7);
const slug = `ui-${run}`;
const member = { email: `ui-${run}@example.com`, password: `pw-${run}-${Math.random().toString(36).slice(2)}` };
const created = { slug, email: member.email };
let shot = 0;
const t0 = Date.now();
const step = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const check = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  step(`ok: ${what}`);
};

async function signIn(page, email, password) {
  await page.waitForSelector("#email");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => u.origin === new URL(base).origin && !u.pathname.startsWith("/auth/")), page.click("button[type=submit]")]);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
    return page;
  };
  const snap = async (page, name) => page.screenshot({ path: `${out}/${String(++shot).padStart(2, "0")}-${name}.png` });

  try {
    // 1. A deep link without a session goes through sign-in and comes back.
    const page = await newPage();
    await page.goto(`${base}/tenants`);
    await signIn(page, adminEmail, adminPassword);
    await page.locator(".p-panel__title").filter({ hasText: "Tenants" }).waitFor();
    check(new URL(page.url()).pathname === "/tenants", "deep link survives sign-in");

    // 2. Create a user.
    await page.goto(`${base}/users`);
    await page.getByRole("button", { name: "Create user" }).click();
    await page.getByLabel("Email").fill(member.email);
    await page.getByLabel("Name").fill(`UI ${run}`);
    await page.getByLabel("Password").fill(member.password);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("link", { name: `UI ${run}` }).waitFor();
    check(true, "user created");

    // 3. Create a tenant with quotas.
    await page.goto(`${base}/tenants`);
    await page.getByRole("button", { name: "Create tenant" }).click();
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Name", { exact: true }).fill(`UI tenant ${run}`);
    await page.getByLabel("Instances").fill("3");
    await page.getByLabel("Memory (GiB)").fill("2");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL(/\/tenants\/[0-9a-f-]{36}$/);
    created.tenantId = page.url().split("/").pop();
    await page.locator(".p-panel__title").filter({ hasText: `UI tenant ${run}` }).waitFor();
    check(true, "tenant created, its page opened");

    // 4. Add the user as a member.
    await page.getByRole("button", { name: "Add member" }).click();
    await page.getByRole("dialog").getByLabel("Email").fill(member.email);
    await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
    await page.getByLabel(`Role of ${member.email}`).waitFor();
    check(true, "member added");
    await snap(page, "tenant");

    // 5. Place the tenant on the cluster and wait for the reconciler.
    await page.goto(`${base}/clusters`);
    await page.getByRole("link", { name: clusterName, exact: true }).click();
    await page.getByLabel("Tenant").selectOption({ label: slug });
    await page.getByRole("button", { name: "Place" }).click();
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: slug }) });
    await row.getByText("Ready").waitFor({ timeout: 60000 });
    check(true, "placed and ready on the cluster");
    await snap(page, "cluster");

    // 5b. An instance in the tenant's project, launched through the gateway with the session (as Incendio does).
    created.instance = `ui-${run}-c1`;
    const launch = await page.request.post(`${base}/clusters/${clusterName}/1.0/instances?project=${slug}`, {
      data: { name: created.instance, source: { type: "image", alias: "alpine/3.22", server: "https://images.linuxcontainers.org", protocol: "simplestreams" }, start: true },
    });
    const op = (await launch.json()).operation;
    const done = await (await page.request.get(`${base}/clusters/${clusterName}${op}/wait?timeout=300`)).json();
    check(done.metadata && done.metadata.status === "Success", `instance launched through the gateway (${done.metadata && done.metadata.status})`);

    // 6. The tenant page shows where it runs.
    await page.goto(`${base}/tenants/${created.tenantId}`);
    await page.getByRole("row").filter({ has: page.getByRole("link", { name: clusterName }) }).getByText("Ready").waitFor();
    check(true, "tenant page shows the cluster as ready");

    // 7. A tenant service account; the secret is shown once.
    await page.locator("#main-content").getByRole("link", { name: "Service accounts" }).click();
    await page.getByRole("button", { name: "Create service account" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("ci");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    const secret = await page.locator(".ic-secret").innerText();
    check(secret.length >= 20, "service account secret shown");
    await snap(page, "secret");
    await page.getByRole("button", { name: "Done" }).click();
    check((await page.locator(".ic-secret").count()) === 0, "secret gone after Done");

    // 8. The audit log has the tenant's creation.
    await page.goto(`${base}/audit?action=tenant.create`);
    await page.locator("table").getByText("tenant.create", { exact: true }).first().waitFor();
    check(true, "audit log filtered by action");

    // 9. The console link opens Incendio for the cluster.
    await page.goto(`${base}/clusters`);
    await page.getByRole("link", { name: clusterName, exact: true }).click();
    await page.getByRole("link", { name: "Open console" }).click();
    await page.waitForURL(new RegExp(`/clusters/${clusterName}/ui/`));
    await page.waitForFunction(() => document.title.includes("Incendio"), null, { timeout: 30000 });
    check(true, "console opens Incendio");

    // 9b. The fleet: the dashboard's capacity and the cluster's members and storage.
    await page.goto(`${base}/`);
    await page.getByRole("heading", { name: "Capacity" }).waitFor();
    await page.locator("table").getByRole("link", { name: clusterName }).waitFor();
    check(true, "dashboard shows capacity per cluster");
    await snap(page, "dashboard");
    await page.locator("table").getByRole("link", { name: clusterName }).click();
    await page.getByRole("heading", { name: "Members and storage" }).waitFor();
    await page.locator("[role=meter]").first().waitFor();
    check(true, "cluster page shows members and storage");
    await snap(page, "cluster-capacity");

    // 10. Sign out.
    await page.goto(`${base}/`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForSelector("#email", { timeout: 15000 }).catch(() => {});
    const r = await page.request.get(`${base}/api/v1/me`);
    check(r.status() === 401, "signed out");

    // 11. The member sees their tenant and the cluster, not administration.
    const mp = await newPage();
    await mp.goto(`${base}/`);
    await signIn(mp, member.email, member.password);
    await mp.getByRole("navigation").getByRole("link", { name: "Clusters" }).waitFor();
    const nav = await mp.locator(".p-side-navigation__link").allInnerTexts();
    check(!nav.some((t) => /Users|Audit log|Service accounts/.test(t)), "member: no administration in the navigation");
    await mp.goto(`${base}/tenants`);
    await mp.getByRole("link", { name: slug }).waitFor();
    check((await mp.getByRole("button", { name: "Create tenant" }).count()) === 0, "member: sees the tenant, cannot create");
    await mp.goto(`${base}/users`);
    await mp.getByText("Not allowed").waitFor();
    check(true, "member: /users answers Not allowed");
    await mp.goto(`${base}/profile`);
    const command = await mp.getByText(`incus remote add ${clusterName}`).innerText();
    const port = new URL(base).port;
    check(!port || command.includes(`:${port} `), `member: profile shows the CLI command (${command.trim()})`);
    await snap(mp, "member-profile");

    // 12. The member finds the instance in the fleet once the inventory has read it, and opens it.
    for (let i = 0; i < 40; i++) {
      await mp.goto(`${base}/instances?q=${created.instance}`);
      // isVisible does not wait; give the list time to load before trying again.
      if (await mp.getByRole("link", { name: created.instance }).waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
      await mp.waitForTimeout(2000);
    }
    await mp.getByRole("link", { name: created.instance }).waitFor({ timeout: 1000 });
    check(true, "member: the instance is in the fleet search");
    await snap(mp, "instances");
    await mp.getByRole("link", { name: created.instance }).click();
    await mp.getByRole("heading", { name: "Last 24 hours" }).waitFor();
    await mp.getByRole("link", { name: "Open in console" }).waitFor();
    check(true, "member: the instance page with its charts");
    await snap(mp, "instance");

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    console.log("UI E2E OK");
  } catch (e) {
    console.log(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e));
    process.exitCode = 1;
  } finally {
    console.log(JSON.stringify(created));
    await browser.close();
  }
})();
