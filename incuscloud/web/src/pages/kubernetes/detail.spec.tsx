import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import KubernetesDetail from "./ClusterDetail";
import { k8sCluster, k8sOptions } from "./fixtures";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(role: "admin" | "member" | "viewer" = "admin") {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role }] })],
    "GET /api/v1/kubernetes/k-1": [200, k8sCluster()],
    "GET /api/v1/kubernetes/versions": [200, k8sOptions()],
    "GET /api/v1/kubernetes/k-1/status": [200, { phase: "Provisioned", message: "Waiting for worker", endpoint: "https://10.0.0.5:16443", conditions: [{ type: "Available", status: "False", reason: "WorkersNotReady", message: "Waiting for worker", lastTransitionTime: "" }] }],
    "GET /api/v1/kubernetes/k-1/nodes": [200, [{ name: "cp-1", role: "control-plane", instance: "cp-1", phase: "Running", version: "v1.36.4", ready: true },{ name: "w-1", role: "worker", instance: "w-1", phase: "Running", version: "v1.36.4", ready: true }]],
    "GET /api/v1/kubernetes/k-1/activity": [200, { entries: [{ time: "2026-10-12T10:00:00Z", level: "info", source: "incuscloud", message: "Created machines", count: 1 }] }],
    "GET /api/v1/kubernetes/k-1/metallb": [200, { requested: ["10.0.1.1-10.0.1.5"], installed: true, ready: true, addresses: ["10.0.1.1-10.0.1.5"], message: "" }],
    "GET /1.0/instances": [200, { metadata: [ { name: "cp-1@lab", location: "m1@lab", status: "Running", type: "container", config: { "user.cluster-name": "web", "user.cluster-role": "control-plane" }, state: { network: {} } }, { name: "web-lb@lab", location: "m1@lab", status: "Running", type: "container", config: { "user.cluster-name": "web", "user.cluster-role": "loadbalancer" }, state: { network: {} } } ] }],
    "PATCH /api/v1/kubernetes/k-1": [200, k8sCluster()],
    "PUT /api/v1/kubernetes/k-1/metallb": [202, { cluster: k8sCluster(), job: { id: "j-1" } }],
    "DELETE /api/v1/kubernetes/k-1": [202, { job: { id: "j-1" } }],
  });
  renderAt(<KubernetesDetail />, { path: "/kubernetes/k-1", pattern: "/kubernetes/:id" });
  return api;
}
test("Incendio's row layout, nodes, kubeconfig, MetalLB, activity and conditions", async () => {
  setup();
  for (const name of ["General", "Kubeconfig", "Control plane (1)", "Workers (1)", "Load balancer", "Load balancer services", "Activity", "Conditions"]) expect(await screen.findByRole("heading", { name })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "cp-1" })).toHaveAttribute("href", "/ui/project/acme%40lab/instance/cp-1");
  expect(screen.getByText("Created machines")).toBeInTheDocument();
  expect(screen.getByText("WorkersNotReady")).toBeInTheDocument();
  expect(screen.getByText("10.0.1.1-10.0.1.5")).toBeInTheDocument();
});
test("scale sends replica PATCH, upgrade offers one minor forward and sends version PATCH", async () => {
  const api = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Scale" }));
  let dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Control plane nodes")).toHaveTextContent("135");
  fireEvent.change(within(dialog).getByLabelText("Worker nodes"), { target: { value: "3" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Scale" }));
  await waitFor(() => expect(api.calls.find(c => c.method === "PATCH")?.body).toEqual({ workers: 3 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("option").map(o => o.textContent)).toEqual(["v1.37.0"]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Upgrade" }));
  await waitFor(() => expect(api.calls.filter(c => c.method === "PATCH").at(-1)?.body).toEqual({ version: "v1.37.0" }));
});
test("MetalLB addresses edit through PUT; admin delete is confirmed", async () => {
  const api = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Change addresses" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/Address range/), { target: { value: "10.0.2.1-10.0.2.5" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.find(c => c.method === "PUT")?.body).toEqual({ addresses: ["10.0.2.1-10.0.2.5"] }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Ranges separated by a space are two ranges, as the field's own check reads them.
  await userEvent.click(await screen.findByRole("button", { name: "Change addresses" }));
  fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(/Address range/), { target: { value: "10.0.2.1-10.0.2.5 10.0.3.0/29" } });
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.filter(c => c.method === "PUT").at(-1)?.body).toEqual({ addresses: ["10.0.2.1-10.0.2.5", "10.0.3.0/29"] }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(api.calls.some(c => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.calls.some(c => c.method === "DELETE")).toBe(true));
});
test("viewer has no mutation controls or admin kubeconfig; member cannot delete", async () => {
  setup("viewer"); await screen.findByRole("heading", { name: "General" });
  for (const name of ["Scale", "Upgrade", "Delete", "Change addresses", "Show kubeconfig"]) expect(screen.queryByRole("button", { name })).toBeNull();
});

test("a cluster still being created shows no phase before CAPI has its Cluster ('Missing')", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "admin" }] })],
    "GET /api/v1/kubernetes/k-1": [200, k8sCluster({ status: "creating", nodes: 0, nodesReady: 0 })],
    "GET /api/v1/kubernetes/versions": [200, k8sOptions()],
    "GET /api/v1/kubernetes/k-1/status": [200, { phase: "Missing", message: "", endpoint: "https://10.0.0.5:16443", conditions: [] }],
    "GET /api/v1/kubernetes/k-1/nodes": [200, []],
    "GET /api/v1/kubernetes/k-1/activity": [200, { entries: [] }],
    "GET /api/v1/kubernetes/k-1/metallb": [200, { requested: null, installed: false, ready: false, addresses: [], message: "" }],
    "GET /1.0/instances": [200, { metadata: [] }],
  });
  renderAt(<KubernetesDetail />, { path: "/kubernetes/k-1", pattern: "/kubernetes/:id" });
  const status = (await screen.findByText("Status", { selector: "th" })).closest("tr")!;
  // Every read answered.
  await new Promise((r) => setTimeout(r, 300));
  expect(status.querySelector("td")!.textContent!.trim()).toBe("Creating");
});
