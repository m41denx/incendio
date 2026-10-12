import { afterEach, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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

/** A Kubernetes cluster in project p on c1. */
const kweb = { id: "k-1", tenantId: "t-1", tenantSlug: "acme", clusterId: "id-1", clusterName: "c1", project: "p", member: "", name: "kweb", version: "v1.37.0", controlPlanes: 1, workers: 1, size: "small", endpoint: "https://10.0.0.1:16443", status: "ready", statusMessage: "", nodes: 2, nodesReady: 2, createdBy: "u", createdAt: "2026-10-12T10:00:00Z", syncedAt: null };

const sync = (metadata: unknown) => [200, { type: "sync", metadata }] as [number, unknown];

/** Two clusters: c1 with members m1 and m2, c2 standalone. */
const api = (over: Parameters<typeof mockApi>[0] = {}) =>
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
    "GET /1.0/projects/default%40c1": sync({ name: "default@c1", description: "", config: {}, used_by: [] }),
    "GET /1.0/projects/p%40c1": sync({ name: "p@c1", description: "", config: {}, used_by: [] }),
    "GET /1.0/network-acls": sync([]),
    "GET /1.0/operations": sync({}),
    "GET /api/v1/kubernetes/versions": [200, { enabled: true, versions: ["v1.37.0"], sizes: { small: { cpu: 2, memoryGiB: 2 } } }],
    "GET /api/v1/kubernetes": [200, [kweb]],
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
  for (const l of ["Tenants", "Jobs", "Sign out"]) expect(n.getByRole("link", { name: l })).toBeInTheDocument();
  // Kubernetes clusters are inventory objects (the root's and each cluster's tab), not a platform page.
  expect(n.queryByRole("link", { name: "Kubernetes" })).not.toBeInTheDocument();
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

test("a cluster tab with a side menu renders the chosen Incendio page for that cluster", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/networks/acls" });
  const menu = within(await screen.findByRole("navigation", { name: "Networks" }));
  expect(menu.getByRole("link", { name: "ACLs" })).toHaveAttribute("aria-current", "page");
  expect(menu.getByRole("link", { name: "Zones" })).toHaveAttribute("href", "/inventory/c1/networks/zones");
  expect(await screen.findByTitle("Learn more about network access control lists")).toBeInTheDocument();
});

test("a cluster tab with a side menu opens its first page", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/storage" });
  const menu = within(await screen.findByRole("navigation", { name: "Storage" }));
  await waitFor(() => expect(menu.getByRole("link", { name: "Pools" })).toHaveAttribute("aria-current", "page"));
});

test("placement groups: a cluster's, for one of its projects", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/groups/placement" });
  expect(await screen.findByText("Placement groups", { selector: ".p-heading--4, h1, h2, .p-panel__title, *" })).toBeInTheDocument();
  const picker = await screen.findByRole("combobox", { name: "Project" });
  expect([...picker.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["default", "p"]);
});

test("a project's tab with several pages shows them in a side menu", async () => {
  api();
  renderInFrame(<AppRoutes />, { path: "/ui/project/p%40c1/network-acls" });
  const menu = within(await screen.findByRole("navigation", { name: "Networks" }));
  expect(menu.getByRole("link", { name: "ACLs" })).toHaveAttribute("aria-current", "page");
  expect(menu.getByRole("link", { name: "IPAM" })).toHaveAttribute("href", "/ui/project/p%40c1/network-ipam");
});

test("Kubernetes: the root's tab lists every cluster's, a cluster's tab its own, with Create for that cluster", async () => {
  api();
  const all = renderInFrame(<AppRoutes />, { path: "/all/kubernetes" });
  const row = (await screen.findByRole("link", { name: "kweb" })).closest("tr")!;
  expect(within(row).getByRole("link", { name: "c1" })).toHaveAttribute("href", "/inventory/c1");
  expect(within(row).getByRole("link", { name: "kweb" })).toHaveAttribute("href", "/ui/project/p%40c1/kubernetes/kweb");
  all.unmount();
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/kubernetes" });
  expect(await screen.findByRole("link", { name: "kweb" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Incus cluster" })).toBeNull();
  expect(screen.getByRole("link", { name: "Create cluster" })).toHaveAttribute("href", "/kubernetes/new?cluster=c1");
});

test("old Kubernetes links land on the new pages", async () => {
  api({ "GET /api/v1/kubernetes/k-1": [200, kweb] });
  const list = renderInFrame(<AppRoutes />, { path: "/kubernetes" });
  await waitFor(async () => expect((await tabRow()).getByRole("link", { name: "Kubernetes" })).toHaveAttribute("aria-current", "page"));
  list.unmount();
  renderInFrame(<AppRoutes />, { path: "/kubernetes/k-1" });
  await waitFor(() => expect(screen.getByRole("navigation", { name: "Breadcrumbs" })).toHaveTextContent("kweb"));
});

const holder = (name: string, role: string, relation: string, kind = "user") => ({ id: `id-${name}`, kind, name, email: `${name}@example.com`, role, relation });

test("a cluster's Access: platform roles on the server, each tenant's members on its project", async () => {
  api({
    "GET /api/v1/access": [
      200,
      {
        cluster: "c1",
        platform: [holder("op", "operator", "operator")],
        tenants: [{ tenant: { id: "t-1", slug: "acme", name: "Acme" }, project: "p", status: "ready", members: [holder("ann", "owner", "operator"), holder("ci", "member", "operator", "service-account")] }],
      },
    ],
  });
  renderInFrame(<AppRoutes />, { path: "/inventory/c1/access" });
  const menu = within(await screen.findByRole("navigation", { name: "Access" }));
  await waitFor(() => expect(menu.getByRole("link", { name: "Who has access" })).toHaveAttribute("aria-current", "page"));
  const platform = within(await screen.findByRole("region", { name: "Platform roles" }));
  expect(within(platform.getByText("op").closest("tr")!).getByText("operator on the server")).toBeInTheDocument();
  const acme = within(screen.getByRole("region", { name: "Acme" }));
  expect(acme.getByRole("link", { name: "p" })).toHaveAttribute("href", "/ui/project/p%40c1/instances");
  expect(within(acme.getByText("ann").closest("tr")!).getByText("operator on project p")).toBeInTheDocument();
  expect(within(acme.getByText("ci").closest("tr")!).getByText("Service account")).toBeInTheDocument();
});

test("a project's Access: its tenant's members; the request names the project", async () => {
  const calls = api({
    "GET /api/v1/access": [200, { cluster: "c1", tenants: [{ tenant: { id: "t-1", slug: "acme", name: "Acme" }, project: "p", status: "ready", members: [holder("ann", "viewer", "viewer")] }] }],
  });
  renderInFrame(<AppRoutes />, { path: "/ui/project/p%40c1/access/who" });
  const acme = within(await screen.findByRole("region", { name: "Acme" }));
  expect(within(acme.getByText("ann").closest("tr")!).getByText("viewer on project p")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Platform roles" })).toBeNull();
  expect(calls.calls.some((c) => c.path === "/api/v1/access?cluster=c1&project=p")).toBe(true);
});

test("while the instances are loading the tree shows no counts (0/0 would say there are none)", async () => {
  api({ "GET /1.0/instances": () => new Promise<[number, unknown?]>(() => {}) });
  renderInFrame(<AppRoutes />, { path: "/" });
  const m1 = (await nav().findByRole("link", { name: "m1" })).closest(".ic-tree__row")!;
  expect(m1.querySelector(".ic-tree__count")).toBeNull();
  expect(nav().getByRole("link", { name: "All clusters" }).closest(".ic-tree__row")!.querySelector(".ic-tree__count")).toBeNull();
});

test("a page still showing a global list when the cluster changes gets the new cluster's", async () => {
  queryClient.clear();
  api();
  let fetched = 0;
  let go: (to: string) => void = () => {};
  // Apart, so the probe does not re-render on navigation: like a page that stays mounted.
  const Go = () => {
    go = useNavigate();
    return null;
  };
  const Probe = () => {
    // Under a global key ("cluster"), of its own: Incendio's pages read the real ones.
    const { data } = useQuery({ queryKey: ["cluster", "probe"], queryFn: async () => `fetch ${++fetched}`, staleTime: Infinity });
    return <span data-testid="probe">{data}</span>;
  };
  renderInFrame(
    <>
      <AppRoutes />
      <Probe />
      <Go />
    </>,
    { path: "/inventory/c1/members" },
  );
  await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("fetch 1"));
  act(() => go("/inventory/c2/members"));
  await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("fetch 2"));
});

test("a tenant member creates instances on a cluster in their own project, not default", async () => {
  api({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t", slug: "p", name: "P", role: "member" }] } as never)],
    "GET /1.0/projects": sync([{ name: "p@c1", description: "", config: {}, used_by: [] }]),
  });
  renderInFrame(<AppRoutes />, { path: "/inventory/c1" });
  await waitFor(() => expect(screen.getByRole("link", { name: "Create instance" })).toHaveAttribute("href", "/ui/project/p%40c1/instances/create"));
});
