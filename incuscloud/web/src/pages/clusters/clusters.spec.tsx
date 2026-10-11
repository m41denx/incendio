import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi, renderAt } from "../../test/api";
import type { Cluster, Placement, Tenant } from "../../api/types";
import ClusterList from "./ClusterList";
import ClusterDetail from "./ClusterDetail";

const cluster = (over: Partial<Cluster> = {}): Cluster => ({
  id: "c-1",
  name: "prod",
  url: "https://10.0.0.1:8443",
  addresses: ["10.0.0.1:8443"],
  fingerprint: "ab".repeat(32),
  status: "ready",
  statusMessage: "",
  labels: { region: "eu" },
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  lastSeenAt: new Date().toISOString(),
  reconciledAt: new Date().toISOString(),
  reconcileRequestedAt: null,
  ...over,
});
const acme: Tenant = { id: "t-1", slug: "acme", name: "Acme", quotas: {}, createdAt: "2026-10-01T00:00:00Z" };
const beta: Tenant = { id: "t-2", slug: "beta", name: "Beta", quotas: {}, createdAt: "2026-10-01T00:00:00Z" };
const placed: Placement = { tenantId: "t-1", slug: "acme", project: "acme", status: "ready", statusMessage: "", createdAt: "2026-10-02T00:00:00Z" };

const detailRoutes = (over: Record<string, Parameters<typeof mockApi>[0][string]> = {}, who = me()) =>
  mockApi({
    "GET /api/v1/me": [200, who],
    "GET /api/v1/clusters/c-1": [200, cluster()],
    "GET /api/v1/clusters/c-1/tenants": [200, [placed]],
    "GET /api/v1/tenants": [200, [acme, beta]],
    ...over,
  });
const renderDetail = () => renderAt(<ClusterDetail />, { path: "/clusters/c-1", pattern: "/clusters/:id" });

test("the list shows status, its message and labels; admins can enrol", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, [cluster(), cluster({ id: "c-2", name: "edge", status: "degraded", statusMessage: "acme: quota invalid", labels: {} })]] });
  renderAt(<ClusterList />);
  const row = (await screen.findByRole("link", { name: "edge" })).closest("tr")!;
  expect(within(row).getByText("Degraded")).toHaveAttribute("title", "acme: quota invalid");
  expect(screen.getByText("region=eu")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enrol cluster" })).toBeInTheDocument();
});

test("tenant members see no enrol button", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: null })], "GET /api/v1/clusters": [200, [cluster()]] });
  renderAt(<ClusterList />);
  await screen.findByRole("link", { name: "prod" });
  expect(screen.queryByRole("button", { name: "Enrol cluster" })).not.toBeInTheDocument();
});

test("enrolling posts name, token and labels, then opens the cluster", async () => {
  const api = mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, []], "POST /api/v1/clusters": [201, cluster({ id: "c-9", name: "lab" })], "GET /api/v1/clusters/c-9": [200, cluster({ id: "c-9", name: "lab" })], "GET /api/v1/clusters/c-9/tenants": [200, []], "GET /api/v1/tenants": [200, []] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/clusters"]}>
        <Routes>
          <Route path="/clusters" element={<ClusterList />} />
          <Route path="/clusters/:id" element={<ClusterDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Enrol cluster" }));
  expect(screen.getByText(/incus config trust add incuscloud --quiet/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "lab");
  await userEvent.type(screen.getByLabelText("Trust token"), "eyJ0b2tlbiI6IjEifQ==");
  await userEvent.type(screen.getByLabelText("Labels"), "region=eu{enter}rack=r1");
  await userEvent.click(screen.getByRole("button", { name: "Enrol" }));
  await screen.findByRole("heading", { name: /lab/ });
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "lab", token: "eyJ0b2tlbiI6IjEifQ==", labels: { region: "eu", rack: "r1" } });
});

test("the detail page offers the console, the CLI command and a reconcile", async () => {
  let requested = false;
  const api = detailRoutes({
    "GET /api/v1/clusters/c-1": () => [200, cluster({ reconcileRequestedAt: requested ? new Date().toISOString() : null })],
    "POST /api/v1/clusters/c-1/reconcile": () => {
      requested = true;
      return [202, { requested: true }];
    },
  });
  renderDetail();
  expect(await screen.findByRole("link", { name: "Open console" })).toHaveAttribute("href", "/clusters/prod/ui/");
  expect(screen.getByText("incus remote add prod https://prod.clusters.test --auth-type=oidc")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reconcile now" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/reconcile"))).toBe(true));
  expect(await screen.findByText(/requested/i)).toBeInTheDocument();
});

test("operators place a tenant and remove it after confirming", async () => {
  const api = detailRoutes({ "PUT /api/v1/clusters/c-1/tenants/t-2": [200, { ...placed, tenantId: "t-2", slug: "beta", project: "beta", status: "pending" }], "DELETE /api/v1/clusters/c-1/tenants/t-1": [204] }, me({ platformRole: "operator" }));
  renderDetail();
  const picker = await screen.findByLabelText("Tenant");
  expect(within(picker).queryByRole("option", { name: "acme" })).not.toBeInTheDocument();
  await userEvent.selectOptions(picker, "t-2");
  await userEvent.click(screen.getByRole("button", { name: "Place" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "PUT" && c.path === "/api/v1/clusters/c-1/tenants/t-2")).toBe(true));
  await userEvent.click(within(screen.getByRole("link", { name: "acme" }).closest("tr")!).getByRole("button", { name: "Remove" }));
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/clusters/c-1/tenants/t-1")).toBe(true));
});

test("deleting a cluster with tenants explains the 409 and offers to force", async () => {
  const api = detailRoutes({
    "DELETE /api/v1/clusters/c-1": (_b, url) => (url.searchParams.get("force") === "true" ? [204] : [409, { error: { code: "cluster_in_use", message: "1 tenant(s) are placed on this cluster; remove them or pass force=true" } }]),
    "GET /api/v1/clusters": [200, []],
  });
  renderDetail();
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  expect(await screen.findByText(/1 tenant\(s\) are placed on this cluster/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete anyway" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/clusters/c-1?force=true")).toBe(true));
});

test("viewers see the cluster without operator controls", async () => {
  detailRoutes({}, me({ platformRole: "viewer" }));
  renderDetail();
  await screen.findByRole("link", { name: "Open console" });
  for (const b of ["Reconcile now", "Delete", "Place", "Remove", "Edit labels"]) expect(screen.queryByRole("button", { name: b })).not.toBeInTheDocument();
});
