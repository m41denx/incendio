import { afterEach, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { queryClient } from "@incendio/ui/context/appProviders";
import { me, mockApi } from "../test/api";
import { incendioApi, renderInFrame } from "../test/incendio";
import { AppRoutes } from "../App";
import { fitTabs } from "./ObjectFrame";

afterEach(() => {
  localStorage.removeItem("ic.view");
  localStorage.removeItem("ic.sidebar");
});

const sync = (metadata: unknown) => [200, { type: "sync", metadata }] as [number, unknown];

/** Two clusters: c1 with members m1 and m2, c2 standalone. */
const api = (over: Record<string, [number, unknown?]> = {}) =>
  mockApi({
    ...incendioApi(),
    "GET /api/v1/me": [200, me({ platformRole: "admin" })],
    "GET /api/v1/clusters": [200, [{ id: "id-1", name: "c1", status: "ready" }, { id: "id-2", name: "c2", status: "ready" }]],
    "GET /1.0/cluster/members": sync([
      { server_name: "m1@c1", status: "Online", url: "https://10.0.0.1:8443", roles: [], groups: ["default"], failure_domain: "default", architecture: "x86_64", description: "", message: "", database: false, config: {} },
      { server_name: "m2@c1", status: "Online", url: "https://10.0.0.2:8443", roles: [], groups: ["default"], failure_domain: "default", architecture: "x86_64", description: "", message: "", database: false, config: {} },
      { server_name: "c2@c2", status: "Online", url: "https://10.0.0.3:8443", roles: [], groups: ["default"], failure_domain: "default", architecture: "x86_64", description: "", message: "", database: false, config: {} },
    ]),
    "GET /1.0/instances": sync([{ name: "web", project: "p@c1", location: "m1@c1", status: "Running", type: "container", config: {}, devices: {}, expanded_config: {}, expanded_devices: {} }]),
    "GET /1.0/projects": sync(["default@c1", "default@c2", "p@c1"].map((name) => ({ name, description: "", config: {}, used_by: [] }))),
    "GET /api/v1/fleet/summary": [200, { instances: { total: 0, byStatus: {} }, clusters: [] }],
    ...over,
  });

const nav = () => within(screen.getByRole("navigation", { name: "main navigation" }));
/** The tree's link to a cluster (a standalone cluster's one member has its name too). */
const clusterLink = async (name: string) => (await nav().findAllByRole("link", { name })).find((a) => a.getAttribute("href") === `/inventory/${name}`)!;
/** The tab row, once it is there. */
const tabRow = () =>
  waitFor(() => {
    const el = document.querySelector(".ic-tabs") as HTMLElement | null;
    expect(el).not.toBeNull();
    return within(el!);
  });

test("the sidebar: tree views, the tree, then Platform and Account; the view is remembered", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/" });
  const n = nav();
  expect(await n.findByRole("link", { name: "m1" })).toBeInTheDocument();
  expect(n.getByRole("link", { name: "All clusters" })).toBeInTheDocument();
  expect(await clusterLink("c2")).toBeInTheDocument();
  for (const v of ["Instances", "Projects", "Members", "Networks", "Storage"]) expect(n.getByRole("button", { name: v })).toBeInTheDocument();
  for (const l of ["Kubernetes", "Tenants", "Jobs", "Sign out"]) expect(n.getByRole("link", { name: l })).toBeInTheDocument();
  // The root's tabs, not the sidebar, lead to the dashboard and the cluster list.
  expect(n.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  expect(n.queryByRole("link", { name: "Clusters" })).not.toBeInTheDocument();
  await userEvent.click(n.getByRole("button", { name: "Projects" }));
  expect(localStorage.getItem("ic.view")).toBe("projects");
  expect(await n.findByRole("link", { name: "p" })).toBeInTheDocument();
});

test("a cluster's tab: breadcrumb, the tab row, and Incendio's page under the console URL", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/members" });
  const crumbs = within(await screen.findByRole("navigation", { name: "Breadcrumbs" }));
  expect(crumbs.getAllByRole("link").map((a) => a.textContent)).toEqual(["All clusters", "c1"]);
  const tabs = within(document.querySelector(".ic-tabs") as HTMLElement);
  expect(tabs.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("Cluster members")).toBeInTheDocument();
});

test("objects with their own tab row get only the breadcrumb", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/ui/project/p%40c1/instance/web" });
  const crumbs = within(await screen.findByRole("navigation", { name: "Breadcrumbs" }));
  expect(crumbs.getAllByRole("link").map((a) => a.textContent)).toEqual(["All clusters", "c1", "p", "web"]);
  expect(document.querySelector(".ic-tabs")).toBeNull();
});

test("tabs that do not fit go into More", () => {
  expect(fitTabs([100, 100, 100, 100], 400, 80)).toBe(4);
  expect(fitTabs([100, 100, 100, 100], 330, 80)).toBe(2);
  expect(fitTabs([100, 100], 0, 80)).toBe(2);
});

test("going to another cluster drops the global lists cached for the last one", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/storage" });
  await screen.findByRole("navigation", { name: "Breadcrumbs" });
  queryClient.setQueryData(["storage"], ["c1's pools"]);
  await userEvent.click(await clusterLink("c2"));
  await waitFor(() => expect(queryClient.getQueryData(["storage"])).toBeUndefined());
});

test("old routes land on the new objects", async () => {
  api();
  const nodes = renderInFrame(<AppRoutes />, { path: "/inventory/c1/nodes" });
  await waitFor(async () => expect((await tabRow()).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page"));
  nodes.unmount();
  const { unmount } = renderInFrame(<AppRoutes />, { path: "/instances" });
  expect((await tabRow()).getByRole("link", { name: "Instances" })).toHaveAttribute("aria-current", "page");
  unmount();
  const second = renderInFrame(<AppRoutes />, { path: "/clusters" });
  expect((await tabRow()).getByRole("link", { name: "Clusters" })).toHaveAttribute("aria-current", "page");
  second.unmount();
  renderInFrame(<AppRoutes />, { path: "/ui/project/default/profiles" });
  await waitFor(() => expect(screen.getByRole("navigation", { name: "Breadcrumbs" })).toHaveTextContent("c1"));
  expect((await tabRow()).getByRole("link", { name: "Profiles" })).toHaveAttribute("aria-current", "page");
});

test("the sidebar is as wide as dragged, between 240 and 360 pixels, and remembers it", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/" });
  const handle = await screen.findByRole("separator", { name: "Resize navigation" });
  fireEvent.mouseDown(handle, { clientX: 240 });
  fireEvent.mouseMove(window, { clientX: 320 });
  fireEvent.mouseUp(window);
  expect(localStorage.getItem("ic.sidebar")).toBe("320");
  fireEvent.mouseDown(handle, { clientX: 320 });
  fireEvent.mouseMove(window, { clientX: 900 });
  fireEvent.mouseUp(window);
  expect(localStorage.getItem("ic.sidebar")).toBe("360");
  expect((screen.getByRole("navigation", { name: "main navigation" }) as HTMLElement).style.getPropertyValue("--ic-sidebar-width")).toBe("360px");
});

test("warnings over every cluster say which cluster", async () => {
  const warning = (uuid: string, location: string) => ({
    uuid,
    location,
    project: "",
    type: "Couldn't find the CGroup memory controller",
    count: 1,
    first_seen_at: "2026-10-12T10:00:00Z",
    last_seen_at: "2026-10-12T10:00:00Z",
    last_message: `on ${location}`,
    severity: "low",
    status: "new",
    entity_url: "",
  });
  api({ "GET /1.0/warnings": sync([warning("w-1", "m1@c1"), warning("w-2", "c2@c2")]) });
  renderInFrame(<AppRoutes />, { path: "/all/warnings" });
  const row = async (text: string) => (await screen.findByText(text)).closest("tr")!;
  expect(within(await row("on m1@c1")).getByRole("cell", { name: "Cluster" })).toHaveTextContent("c1");
  expect(within(await row("on c2@c2")).getByRole("cell", { name: "Cluster" })).toHaveTextContent("c2");
  expect(screen.getByRole("columnheader", { name: /^Cluster/ })).toBeInTheDocument();
});

test("tree rows show their kind's icon, tinted by status", async () => {
  api();
  // The selected instance's rows above it are open.
  renderInFrame(<AppRoutes />, { path: "/ui/project/p%40c1/instance/web" });
  const row = (await nav().findByRole("link", { name: "web" })).closest(".ic-tree__row")!;
  expect(row.querySelector("svg.ic-kind")).toHaveClass("ic-kind--container", "ic-tone--ok");
  const member = (await nav().findByRole("link", { name: "m1" })).closest(".ic-tree__row")!;
  expect(member.querySelector("svg.ic-kind")).toHaveClass("ic-kind--member", "ic-tone--ok");
});
