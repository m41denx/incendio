import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { Instance } from "../../api/types";
import MigrateInstance from "./MigrateInstance";

const instance = { id: "i-1", clusterId: "c-1", clusterName: "lab", project: "acme", name: "web", tenantId: "t-1", tenantSlug: "acme", type: "container", status: "Running" } as Instance;
const placements = [
  { clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-2", clusterName: "edge", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-3", clusterName: "far", project: "acme", status: "error", statusMessage: "down", createdAt: "" },
];
const tenantAdmin = me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "admin" }] });

function show(i: Instance = instance) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/instances/i-1"]}>
        <Routes>
          <Route path="/instances/:id" element={<MigrateInstance instance={i} onClose={() => {}} />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("a tenant admin chooses among the tenant's other ready placements", async () => {
  mockApi({ "GET /api/v1/me": [200, tenantAdmin], "GET /api/v1/tenants/t-1/placements": [200, placements] });
  show();
  const select = await screen.findByLabelText("Target cluster");
  await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["edge"]));
  expect(screen.queryByLabelText("Transport")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Move live")).not.toBeInTheDocument();
});

test("problems from the check block the start; changing the form asks for a new check", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "POST /api/v1/instances/i-1/migrations/preflight": [200, { ok: false, problems: ['An instance named "web" already exists on the target'], warnings: [], targetProject: "acme", targetName: "web" }],
  });
  show();
  await screen.findByRole("option", { name: "edge" });
  await userEvent.click(screen.getByRole("button", { name: "Check" }));
  expect(await screen.findByText('An instance named "web" already exists on the target')).toBeInTheDocument();
  // react-components marks disabled buttons with aria-disabled.
  expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute("aria-disabled", "true");
  // Enter in a field does not start it either.
  await userEvent.type(screen.getByLabelText("Name on the target"), "{Enter}");
  expect(api.calls.some((c) => c.path === "/api/v1/instances/i-1/migrations")).toBe(false);
  expect(api.calls.find((c) => c.path.endsWith("/preflight"))!.body).toEqual({ targetClusterId: "c-2", mode: "move", targetName: "web" });
  await userEvent.clear(screen.getByLabelText("Name on the target"));
  await userEvent.type(screen.getByLabelText("Name on the target"), "web2");
  expect(screen.queryByText('An instance named "web" already exists on the target')).not.toBeInTheDocument();
});

test("a clean check shows its warnings; Start queues the job and opens it", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "POST /api/v1/instances/i-1/migrations/preflight": [200, { ok: true, problems: [], warnings: ["The copy is not started"], targetProject: "acme", targetName: "web" }],
    "POST /api/v1/instances/i-1/migrations": [202, { id: "j-9", type: "migrate", state: "queued" }],
  });
  show();
  await screen.findByRole("option", { name: "edge" });
  await userEvent.click(screen.getByLabelText("Copy"));
  await userEvent.click(screen.getByRole("button", { name: "Check" }));
  expect(await screen.findByText("The copy is not started")).toBeInTheDocument();
  expect(screen.getByText(/Ready to copy to acme on edge/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST" && c.path === "/api/v1/instances/i-1/migrations")!.body).toEqual({ targetClusterId: "c-2", mode: "copy", targetName: "web" });
});

test("platform operators pick any other cluster and a transport; running VMs may move live", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "operator" })],
    "GET /api/v1/clusters": [200, [{ id: "c-1", name: "lab" }, { id: "c-2", name: "edge" }, { id: "c-3", name: "far" }]],
    "POST /api/v1/instances/i-1/migrations/preflight": [200, { ok: true, problems: [], warnings: [], targetProject: "acme", targetName: "web" }],
  });
  show({ ...instance, type: "virtual-machine" });
  const select = await screen.findByLabelText("Target cluster");
  await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["edge", "far"]));
  await userEvent.selectOptions(select, "c-3");
  await userEvent.selectOptions(screen.getByLabelText("Transport"), "relay");
  await userEvent.click(screen.getByLabelText("Move live"));
  await userEvent.click(screen.getByRole("button", { name: "Check" }));
  await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/preflight"))!.body).toEqual({ targetClusterId: "c-3", mode: "move", targetName: "web", live: true, transport: "relay" }));
});
