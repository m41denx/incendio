import { afterEach, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { me, mockApi } from "../test/api";
import { incendioApi, renderInFrame } from "../test/incendio";
import Shell from "./Shell";

// Section labels, and "Profile" for the link to /profile (labelled with the user's name).
const labels = async () => {
  await screen.findByText("Clusters");
  return screen.getAllByRole("link").map((a) => (a.getAttribute("href") === "/profile" ? "Profile" : a.textContent?.trim())).filter(Boolean);
};

test("platform admins see every section", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: "admin" })] });
  renderInFrame(<Shell />);
  expect(await labels()).toEqual(expect.arrayContaining(["Dashboard", "Instances", "Kubernetes", "Clusters", "Tenants", "Jobs", "Replication", "Backups", "Balancing", "Backup targets", "Users", "Service accounts", "Audit log", "Gateway log", "Profile"]));
});

test("tenant members see their tenants and clusters, not platform administration", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t1", slug: "acme", name: "Acme", role: "member" }] })] });
  renderInFrame(<Shell />);
  const l = await labels();
  expect(l).toEqual(expect.arrayContaining(["Dashboard", "Instances", "Kubernetes", "Clusters", "Tenants", "Jobs", "Replication", "Backups", "Balancing", "Profile"]));
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
  await screen.findByText("Clusters");
  expect(container.querySelector("nav.l-navigation .l-navigation__drawer .p-panel.is-dark")).not.toBeNull();
  expect(container.querySelector("nav .p-panel__logo .logo-text")).toHaveTextContent("IncusCloud");
  expect(container.querySelector("header.l-navigation-bar")).not.toBeNull();
  // Incendio's status bar: the version once the facade's /1.0 has answered.
  expect(await screen.findByText(/^Version \d+\.\d+\.\d+/)).toHaveClass("server-version");
});

test("the navigation collapses and expands", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  const { container } = renderInFrame(<Shell />);
  await screen.findByText("Clusters");
  const nav = () => container.querySelector("nav.l-navigation")!;
  expect(nav()).toHaveClass("is-pinned");
  await userEvent.click(screen.getByRole("button", { name: "collapse main navigation" }));
  expect(nav()).toHaveClass("is-collapsed");
  await userEvent.click(screen.getByRole("button", { name: "expand main navigation" }));
  expect(nav()).toHaveClass("is-pinned");
});

test("on small and medium screens the navigation starts collapsed, as Incendio's does", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  const width = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { value: 700, configurable: true });
  try {
    const { container } = renderInFrame(<Shell />);
    await screen.findByText("Clusters");
    expect(container.querySelector("nav.l-navigation")).toHaveClass("is-collapsed");
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(container.querySelector("nav.l-navigation")).toHaveClass("is-pinned");
  } finally {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  }
});

afterEach(() => {
  localStorage.removeItem("theme");
  document.body.classList.remove("is-dark");
});

test("sections in order, each labelled: the project's, Incus-wide, the platform's (dashboard first), the account", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me({ platformRole: "admin" })] });
  renderInFrame(<Shell />);
  await screen.findByText("Clusters");
  const order = [...document.querySelectorAll(".project-select-label, .navigation-section-label, .p-side-navigation__link")].map((e) => e.textContent?.trim());
  const at = (x: string) => order.findIndex((t) => t === x || t?.endsWith(x));
  expect(order.filter((t) => ["Project", "Infrastructure", "Platform", "Account"].includes(t ?? ""))).toEqual(["Project", "Infrastructure", "Platform", "Account"]);
  expect(at("Project")).toBeLessThan(at("Instances"));
  expect(at("Platform")).toBeLessThan(at("Dashboard"));
  expect(at("Dashboard")).toBeLessThan(at("Kubernetes"));
  expect(at("Kubernetes")).toBeLessThan(at("Clusters"));
  expect(at("Account")).toBeLessThan(at("Sign out"));
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

test("a merged project's profiles are one cluster's: the page goes to the project there, and the selector shows it by name", async () => {
  mockApi({
    ...incendioApi(),
    "GET /api/v1/me": [200, me({ platformRole: "admin" })],
    "GET /1.0/projects": [200, { type: "sync", metadata: ["default", "default@c1", "default@c2", "solo@c2"].map((name) => ({ name, description: "", config: {}, used_by: [] })) }],
    "GET /1.0/projects/default%40c1": [200, { type: "sync", metadata: { name: "default@c1", description: "", config: {}, used_by: [] } }],
    "GET /1.0/operations": [200, { type: "sync", metadata: {} }],
  });
  renderInFrame(
    <Routes>
      <Route element={<Shell />}>
        <Route path="*" element={<Where />} />
      </Route>
    </Routes>,
    { path: "/ui/project/default/profiles", pattern: "/*" },
  );
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ui/project/default%40c1/profiles"));
  // The project by name, the cluster beside it.
  await userEvent.click(await screen.findByRole("button", { name: "default" }));
  expect(screen.getByRole("button", { name: "c1" })).toBeInTheDocument();
  expect([...document.querySelectorAll(".project-select .projects .name")].map((e) => e.textContent)).toEqual(["default", "solo"]);
});
