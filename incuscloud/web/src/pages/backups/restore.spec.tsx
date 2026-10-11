import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { Backup } from "../../api/types";
import RestoreBackup from "./RestoreBackup";

const backup = { id: "b-1", tenantId: "t-1", clusterId: "c-1", clusterName: "lab", project: "acme", instanceName: "web", state: "ready" } as Backup;
const placements = [
  { clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-2", clusterName: "edge", project: "acme-e", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-3", clusterName: "far", project: "acme", status: "error", statusMessage: "down", createdAt: "" },
];
const tenantAdmin = me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "admin" }] });

function show(b: Backup = backup) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/backups"]}>
        <Routes>
          <Route path="/backups" element={<RestoreBackup backup={b} onClose={() => {}} />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("a tenant admin restores to the tenant's ready placements, its own cluster included, under a free-looking name", async () => {
  const api = mockApi({ "GET /api/v1/me": [200, tenantAdmin], "GET /api/v1/tenants/t-1/placements": [200, placements], "POST /api/v1/backups/b-1/restore": [202, { id: "j-7" }] });
  show();
  const select = await screen.findByLabelText("Cluster");
  await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["lab", "edge"]));
  // Next to the original: a new name; elsewhere the original name.
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("web-restored"));
  await userEvent.selectOptions(select, "c-2");
  expect(screen.getByLabelText("Name")).toHaveValue("web");
  expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Storage pool")).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Start it afterwards"));
  await userEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ targetClusterId: "c-2", targetName: "web", start: true });
});

test("a name the user typed is kept when the cluster changes", async () => {
  mockApi({ "GET /api/v1/me": [200, tenantAdmin], "GET /api/v1/tenants/t-1/placements": [200, placements] });
  show();
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("web-restored"));
  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.type(screen.getByLabelText("Name"), "rescue");
  await userEvent.selectOptions(screen.getByLabelText("Cluster"), "c-2");
  expect(screen.getByLabelText("Name")).toHaveValue("rescue");
});

test("platform operators choose any cluster, and may set the project and pool", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "operator" })],
    "GET /api/v1/clusters": [200, [{ id: "c-1", name: "lab" }, { id: "c-9", name: "spare" }]],
    "POST /api/v1/backups/b-1/restore": [202, { id: "j-8" }],
  });
  show();
  const select = await screen.findByLabelText("Cluster");
  await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["lab", "spare"]));
  await userEvent.selectOptions(select, "c-9");
  await userEvent.type(screen.getByLabelText("Project"), "rescue");
  await userEvent.type(screen.getByLabelText("Storage pool"), "fast");
  await userEvent.click(screen.getByRole("button", { name: "Restore" }));
  await screen.findByText("job page");
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ targetClusterId: "c-9", targetName: "web", targetProject: "rescue", pool: "fast", start: false });
});

test("refusals from the API stay in the dialog", async () => {
  mockApi({ "GET /api/v1/me": [200, tenantAdmin], "GET /api/v1/tenants/t-1/placements": [200, placements], "POST /api/v1/backups/b-1/restore": [409, { error: { code: "conflict", message: "Only a ready backup can be restored (this one is creating)" } }] });
  show();
  await screen.findByRole("option", { name: "edge" });
  await userEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(await screen.findByText(/Only a ready backup can be restored/)).toBeInTheDocument();
});
