import { afterEach, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { me, mockApi } from "../test/api";
import { incendioApi, renderInFrame } from "../test/incendio";
import Shell from "../components/Shell";

// The sidebar's links, and "Profile" for the link to /profile (labelled with the user's name).
const labels = async () => {
  await screen.findByRole("link", { name: "Kubernetes" });
  const nav = screen.getByRole("navigation", { name: "main navigation" });
  return [...nav.querySelectorAll("a")].map((a) => (a.getAttribute("href") === "/profile" ? "Profile" : a.textContent?.trim())).filter(Boolean);
};
const ready = () => screen.findByRole("link", { name: "Kubernetes" });
/** Incendio announces a collapse or expand 500ms later: wait for it, so it does not outlive the test. */
const toggled = () => new Promise((resolve) => window.addEventListener("menu-collapse-toggle", resolve, { once: true }));

test("platform admins see every section", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: "admin" })] });
  renderInFrame(<Shell />);
  expect(await labels()).toEqual(expect.arrayContaining(["All clusters", "Kubernetes", "Tenants", "Jobs", "Replication", "Backups", "Balancing", "Backup targets", "Users", "Service accounts", "Audit log", "Gateway log", "Profile"]));
});

test("tenant members see the platform's pages they use, not its administration", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t1", slug: "acme", name: "Acme", role: "member" }] })] });
  renderInFrame(<Shell />);
  const l = await labels();
  expect(l).toEqual(expect.arrayContaining(["All clusters", "Kubernetes", "Tenants", "Jobs", "Replication", "Backups", "Balancing", "Profile"]));
  for (const hidden of ["Backup targets", "Users", "Service accounts", "Audit log", "Gateway log"]) expect(l).not.toContain(hidden);
});

test("tenant admins also manage their service accounts and see their logs", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t1", slug: "acme", name: "Acme", role: "admin" }] })] });
  renderInFrame(<Shell />);
  const l = await labels();
  expect(l).toEqual(expect.arrayContaining(["Service accounts", "Audit log", "Gateway log"]));
  expect(l).not.toContain("Users");
});

test("sign out is a navigation entry that posts to /auth/logout", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
    expect(this.getAttribute("method")).toBe("post");
    expect(this.getAttribute("action")).toBe("/auth/logout");
  });
  renderInFrame(<Shell />);
  const link = await screen.findByRole("link", { name: "Sign out" });
  expect(link).toHaveClass("p-side-navigation__link");
  await userEvent.click(link);
  expect(submit).toHaveBeenCalledOnce();
  submit.mockRestore();
});

test("Incendio's frame: a dark navigation panel with the logo, and the version in the status bar", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  const { container } = renderInFrame(<Shell />);
  await ready();
  expect(container.querySelector("nav.l-navigation .l-navigation__drawer .p-panel.is-dark")).not.toBeNull();
  expect(container.querySelector("nav .p-panel__logo .logo-text")).toHaveTextContent("IncusCloud");
  expect(container.querySelector("header.l-navigation-bar")).not.toBeNull();
  // Incendio's status bar: the version once the facade's /1.0 has answered.
  expect(await screen.findByText(/^Version \d+\.\d+\.\d+/)).toHaveClass("server-version");
});

test("the navigation collapses and expands", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  const { container } = renderInFrame(<Shell />);
  await ready();
  const nav = () => container.querySelector("nav.l-navigation")!;
  expect(nav()).toHaveClass("is-pinned");
  await userEvent.click(screen.getByRole("button", { name: "collapse main navigation" }));
  expect(nav()).toHaveClass("is-collapsed");
  const done = toggled();
  await userEvent.click(screen.getByRole("button", { name: "expand main navigation" }));
  expect(nav()).toHaveClass("is-pinned");
  await done;
});

test("on small and medium screens the navigation starts collapsed, as Incendio's does", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  const width = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { value: 700, configurable: true });
  try {
    const { container } = renderInFrame(<Shell />);
    await ready();
    expect(container.querySelector("nav.l-navigation")).toHaveClass("is-collapsed");
    const done = toggled();
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(container.querySelector("nav.l-navigation")).toHaveClass("is-pinned");
    await done;
  } finally {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  }
});

afterEach(() => {
  localStorage.removeItem("theme");
  document.body.classList.remove("is-dark");
});

test("the tree first, then Platform and Account, each labelled; the dashboard and the cluster list are the root's tabs", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: "admin" })] });
  renderInFrame(<Shell />);
  await ready();
  const order = [...document.querySelectorAll(".ic-tree__label, .ic-section-label, .p-side-navigation__link")].map((e) => e.textContent?.trim());
  const at = (x: string) => order.findIndex((t) => t === x || t?.endsWith(x));
  expect(order.filter((t) => ["Platform", "Account"].includes(t ?? ""))).toEqual(["Platform", "Account"]);
  expect(at("All clusters")).toBeLessThan(at("Platform"));
  expect(at("Platform")).toBeLessThan(at("Kubernetes"));
  expect(at("Account")).toBeLessThan(at("Sign out"));
  for (const gone of ["Dashboard", "Clusters", "Infrastructure", "Project"]) expect(order).not.toContain(gone);
});

test("the saved theme (Incendio's setting) applies on every page, not only Incendio's", async () => {
  localStorage.setItem("theme", "dark");
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  renderInFrame(<Shell />);
  await waitFor(() => expect(document.body).toHaveClass("is-dark"));
});

/** Shows where the app navigated. */
const Where = () => {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
};

test("an unqualified project (an old link) goes to the project on a cluster that has it", async () => {
  mockApi({
    ...incendioApi(),
    "GET /api/v1/me": [200, me({ platformRole: "admin" })],
    "GET /1.0/projects": [200, { type: "sync", metadata: ["default@c1", "default@c2", "solo@c2"].map((name) => ({ name, description: "", config: {}, used_by: [] })) }],
  });
  renderInFrame(
    <Routes>
      <Route element={<Shell />}>
        <Route path="*" element={<Where />} />
      </Route>
    </Routes>,
    { path: "/ui/project/solo/profiles", pattern: "/*" },
  );
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ui/project/solo%40c2/profiles"));
});
