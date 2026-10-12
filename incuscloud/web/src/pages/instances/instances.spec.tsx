import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { Cluster, Instance, InstanceList } from "../../api/types";
import InstancesPage from "./InstanceList";

const edge: Cluster = {
  id: "c-1",
  name: "edge-1",
  url: "https://edge-1.test:8443",
  addresses: [],
  fingerprint: "",
  status: "ready",
  statusMessage: "",
  labels: {},
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  lastSeenAt: null,
  reconciledAt: null,
  reconcileRequestedAt: null,
};

const instance = (over: Partial<Instance> = {}): Instance => ({
  id: "i-1",
  clusterId: "c-1",
  clusterName: "edge-1",
  project: "default",
  name: "web-1",
  tenantId: null,
  tenantSlug: null,
  type: "container",
  status: "Running",
  location: "rack-1",
  description: "",
  architecture: "x86_64",
  createdAt: null,
  imageOs: "",
  imageRelease: "",
  limitsCpu: "",
  limitsMemory: "",
  cpuCores: 0.5,
  memoryUsed: 100,
  memoryTotal: 1000,
  diskUsed: null,
  netRxBps: null,
  netTxBps: null,
  addresses: ["fd00::1", "10.0.0.5"],
  seenAt: "2026-10-10T10:00:00Z",
  inventoryAt: null,
  ...over,
});

const list = (items: Instance[], total = items.length): InstanceList => ({ items, total });

const row = (text: string) => screen.findByText(text).then((el) => el.closest("tr")!);

test("instance rows render with link, cluster, IPv4, CPU and memory", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/instances": [200, list([instance()])],
  });
  renderAt(<InstancesPage />, { path: "/instances" });
  const r = await row("web-1");
  expect(within(r).getByRole("link", { name: "web-1" })).toHaveAttribute("href", "/instances/i-1");
  expect(within(r).getByText("edge-1")).toBeInTheDocument();
  expect(within(r).getByText("10.0.0.5")).toBeInTheDocument();
  expect(within(r).getByText("0.50")).toBeInTheDocument();
  expect(within(r).getByText("100 B / 1000 B")).toBeInTheDocument();
  expect(screen.getByText("Showing 1 of 1 instances")).toBeInTheDocument();
});

test("typing in Search sends q to the API after the debounce", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/instances": [200, list([instance()])],
  });
  renderAt(<InstancesPage />, { path: "/instances" });
  await screen.findByText("web-1");
  await userEvent.type(screen.getByLabelText("Search"), "web");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/instances") && c.path.includes("q=web"))).toBe(true));
});

test("the status and type filters reach the API", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/instances": [200, list([instance()])],
  });
  renderAt(<InstancesPage />, { path: "/instances" });
  await screen.findByText("web-1");
  await userEvent.selectOptions(screen.getByLabelText("Status"), "Running");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/instances") && c.path.includes("status=Running"))).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText("Type"), "container");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/instances") && c.path.includes("type=container"))).toBe(true));
});

test("a tenant member sees no Cluster or Tenant filter; a platform viewer sees the Cluster filter", async () => {
  const memberApi = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] })],
    "GET /api/v1/instances": [200, list([instance()])],
  });
  const member = renderAt(<InstancesPage />, { path: "/instances" });
  await screen.findByText("web-1");
  expect(screen.queryByLabelText("Cluster")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Tenant")).not.toBeInTheDocument();
  expect(memberApi.calls.some((c) => c.path === "/api/v1/clusters")).toBe(false);
  member.unmount();

  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "viewer" })],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/instances": [200, list([instance()])],
  });
  renderAt(<InstancesPage />, { path: "/instances" });
  await screen.findByText("web-1");
  expect(screen.getByLabelText("Cluster")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Cluster")).getByRole("option", { name: "edge-1" })).toBeInTheDocument();
});

test("Load more requests offset=100 when total is 150", async () => {
  const first = Array.from({ length: 100 }, (_, i) => instance({ id: `i-${i + 1}`, name: `web-${i + 1}` }));
  const second = Array.from({ length: 50 }, (_, i) => instance({ id: `i-${i + 101}`, name: `web-${i + 101}` }));
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/instances": (_body, url) => (url.searchParams.get("offset") === "100" ? [200, list(second, 150)] : [200, list(first, 150)]),
  });
  renderAt(<InstancesPage />, { path: "/instances" });
  await screen.findByText("web-1");
  expect(screen.getByText("Showing 100 of 150 instances")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("web-150")).toBeInTheDocument();
  expect(api.calls.some((c) => c.path.includes("limit=100") && c.path.includes("offset=100"))).toBe(true);
  expect(screen.getByText("Showing 150 of 150 instances")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
});

test("an empty result with a search shows No instances match.", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/instances": [200, list([])],
  });
  renderAt(<InstancesPage />, { path: "/instances?q=zzz" });
  expect(await screen.findByText("No instances match.")).toBeInTheDocument();
});

test("Create instance is offered to tenant members and platform operators, not to viewers", async () => {
  const show = async (who: ReturnType<typeof me>) => {
    mockApi({ "GET /api/v1/me": [200, who], "GET /api/v1/clusters": [200, [edge]], "GET /api/v1/tenants": [200, []], "GET /api/v1/instances": [200, list([])] });
    const view = renderAt(<InstancesPage />, { path: "/instances" });
    await screen.findByText("No instances found");
    const link = screen.queryByRole("link", { name: "Create instance" });
    view.unmount();
    return link?.getAttribute("href") ?? null;
  };
  expect(await show(me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] }))).toBe("/instances/new");
  expect(await show(me({ platformRole: "operator", tenants: [] }))).toBe("/instances/new");
  expect(await show(me({ platformRole: "viewer", tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "viewer" }] }))).toBeNull();
});
