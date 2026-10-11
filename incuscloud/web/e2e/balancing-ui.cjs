// The balancing UI in a real browser (Playwright), against scripts/dev.sh with
// a clustered, enrolled cluster:
//   node balancing-ui.cjs <base-url> <admin-email> <admin-password> <cluster> <out-dir>
// Opens the cluster's Balancing section: saves settings through the form,
// previews, rebalances (the job page reads the result), opens the evacuate
// dialog without evacuating, and the Balancing page; screenshots each.
// Puts the settings back to automatic off at the end.
const { chromium } = require("playwright");

const [base, email, password, cluster, out = "."] = process.argv.slice(2);
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
  let clusterId;
  try {
    await page.goto(`${base}/`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth/") && u.origin === new URL(base).origin), page.click("button[type=submit]")]);

    await page.goto(`${base}/clusters`);
    await page.getByRole("link", { name: cluster }).click();
    await page.waitForURL(/\/clusters\/[0-9a-f-]{36}$/);
    clusterId = page.url().split("/").pop();
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Balancing" }) });
    await section.waitFor();

    // Settings through the form.
    await section.getByRole("button", { name: "Settings…" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Measure").selectOption("assigned");
    await form.getByLabel("Every (minutes)").fill("30");
    await form.getByLabel("Allow restarts").setChecked(true, { force: true });
    await snap("settings");
    await form.getByRole("button", { name: "Save" }).click();
    await form.waitFor({ state: "detached" });
    await section.getByText("memory assigned").waitFor();
    await section.getByText("Moved with a restart when needed").waitFor();
    check(true, "settings saved through the form");

    // Preview and run.
    await section.getByRole("button", { name: "Preview" }).click();
    await section.getByText(/^Spread now: /).waitFor();
    check(true, `preview: ${await section.getByText(/^Spread now: /).textContent()}`);
    await snap("cluster-balancing");
    await section.getByRole("button", { name: "Rebalance now" }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    await page.getByText(/^(Succeeded|Failed)$/).first().waitFor({ timeout: 240000 });
    check((await page.getByText("Succeeded", { exact: true }).count()) > 0, "the rebalance job succeeded");
    await page.getByText(/^Spread .* points$/).waitFor();
    await snap("rebalance-job");

    // The evacuate dialog, cancelled.
    await page.goto(`${base}/clusters/${clusterId}`);
    const members = page.locator("section", { has: page.getByRole("heading", { name: "Members and storage" }) });
    await members.getByRole("button", { name: "Evacuate…" }).first().click();
    await page.getByRole("dialog").getByLabel("Mode").waitFor();
    await snap("evacuate");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    check(true, "evacuate dialog opens and cancels");

    await page.getByRole("link", { name: "Balancing" }).click();
    await page.getByRole("heading", { name: "Balancing" }).first().waitFor();
    await page.getByText(/^No suggestions|Move…/).first().waitFor();
    await snap("suggestions");
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    console.log("BALANCING UI OK");
  } catch (e) {
    console.log(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e));
    await snap("failure").catch(() => {});
    process.exitCode = 1;
  } finally {
    if (clusterId) {
      await page.request
        .fetch(`${base}/api/v1/clusters/${clusterId}/balancing`, {
          method: "PUT",
          headers: { origin: base },
          data: { enabled: false, intervalS: 3600, method: "memory", mode: "used", balanciness: 10, maxMoves: 5, allowRestart: false, excludeMembers: [], excludeProjects: [] },
        })
        .catch(() => {});
    }
    await browser.close();
  }
})();
