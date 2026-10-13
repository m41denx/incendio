import { afterEach, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { K8sCluster, K8sOptions, Me } from "../../api/types";
import ClusterList from "./ClusterList";
import { k8sCluster, k8sOptions } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const memberOf = (role: "owner" | "admin" | "member" | "viewer"): Me => me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role }] });
const api = (o: { me?: Me; options?: K8sOptions; list?: K8sCluster[] } = {}) =>
  mockApi({
    "GET /api/v1/me": [200, o.me ?? memberOf("admin")],
    "GET /api/v1/kubernetes/versions": [200, o.options ?? k8sOptions()],
    "GET /api/v1/kubernetes": [200, o.list ?? [k8sCluster(), k8sCluster({ id: "k-2", name: "api", clusterName: "edge", status: "degraded", statusMessage: "* ControlPlaneAvailable: waiting\n* more", nodesReady: 1, nodes: 2, workers: 1 })]],
    "DELETE /api/v1/kubernetes/k-1": [202, { job: { id: "j-1" } }],
  });

test("Incendio's cluster list: name, status (and why), version, control plane, workers, endpoint, tenant, Incus cluster", async () => {
  api();
  renderAt(<ClusterList />, { path: "/kubernetes" });
  expect(screen.getByRole("heading", { name: "Kubernetes clusters" })).toBeInTheDocument();
  const table = await screen.findByRole("grid");
  const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
  expect(headers.slice(0, 8)).toEqual(["Name", "Status", "Kubernetes version", "Control plane", "Workers", "API endpoint", "Tenant", "Incus cluster"]);
  const web = (await screen.findByRole("link", { name: "web" })).closest("tr")!;
  expect(within(web).getByRole("link", { name: "web" })).toHaveAttribute("href", "/kubernetes/k-1");
  expect(within(web).getByText("Ready")).toBeInTheDocument();
  expect(within(web).getByText("10.0.0.5:16443")).toBeInTheDocument();
  expect(within(web).getByRole("link", { name: "acme" })).toHaveAttribute("href", "/tenants/t-1");
  const apiRow = screen.getByRole("link", { name: "api" }).closest("tr")!;
  expect(within(apiRow).getByText("Degraded")).toBeInTheDocument();
  // CAPI's message is a bullet list; the first line names the blocker.
  expect(within(apiRow).getByText("ControlPlaneAvailable: waiting")).toBeInTheDocument();
  expect(within(apiRow).getByText("edge")).toBeInTheDocument();
});

test("filtered by Incus cluster (from a cluster's page): its clusters only, and Create carries it", async () => {
  api();
  renderAt(<ClusterList />, { path: "/kubernetes?cluster=edge" });
  expect(await screen.findByRole("link", { name: "api" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "web" })).toBeNull();
  expect(screen.getByRole("link", { name: "Create cluster" })).toHaveAttribute("href", "/kubernetes/new?cluster=edge");
});

test("without a management cluster the list says so and offers no create", async () => {
  api({ options: k8sOptions(false), list: [] });
  renderAt(<ClusterList />, { path: "/kubernetes" });
  expect(await screen.findByText(/IncusCloud has no management cluster/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Create cluster" })).toBeNull();
});

test("viewers see the list without Create or Delete", async () => {
  api({ me: memberOf("viewer") });
  renderAt(<ClusterList />, { path: "/kubernetes" });
  const web = (await screen.findByRole("link", { name: "web" })).closest("tr")!;
  expect(within(web).queryByRole("button", { name: /Delete/ })).toBeNull();
  expect(screen.queryByRole("link", { name: "Create cluster" })).toBeNull();
});

test("an admin deletes from the list after confirming", async () => {
  const calls = api();
  renderAt(<ClusterList />, { path: "/kubernetes" });
  const web = (await screen.findByRole("link", { name: "web" })).closest("tr")!;
  await userEvent.click(within(web).getByRole("button", { name: "Delete" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(calls.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/kubernetes/k-1")).toBe(true));
});
