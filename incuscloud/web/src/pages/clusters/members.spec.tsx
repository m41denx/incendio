import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockApi } from "../../test/api";
import type { ClusterInventory as InventoryData, ClusterMember } from "../../api/types";
import ClusterInventory from "./ClusterInventory";

const GiB = 1024 ** 3;

const member = (name: string, status: string): ClusterMember => ({
  name,
  url: `https://10.0.0.1${name.length}:8443`,
  status,
  roles: [],
  architecture: "x86_64",
  cpuThreads: 8,
  memoryTotal: 16 * GiB,
  memoryUsed: 4 * GiB,
  load1: 0.5,
  uptimeS: 60,
});
const inventory = (members: ClusterMember[]): InventoryData => ({
  inventoryAt: new Date().toISOString(),
  inventoryError: "",
  members,
  pools: [],
  networks: [],
  instances: { total: 0, running: 0 },
});
const members = [member("node1", "Online"), member("node2", "Evacuated"), member("node3", "Offline")];
const job = { id: "j-7", type: "evacuate", state: "pending", progress: { stage: "queued" }, payload: {}, result: null, error: "", tenantId: null, clusterIds: ["c-1"], instanceKey: null, actorType: "user", actorId: "u-1", cancelRequested: false };

const renderInventory = (canManage?: boolean) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/clusters/c-1"]}>
        <Routes>
          <Route path="/clusters/c-1" element={<ClusterInventory clusterId="c-1" canManage={canManage} />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const rowOf = async (name: string) => (await screen.findByText(name)).closest("tr")!;

test("without canManage the members table has no actions column", async () => {
  mockApi({ "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)] });
  renderInventory();
  await rowOf("node1");
  expect(document.querySelector(".ic-col-actions")).toBeNull();
  expect(screen.queryByRole("button", { name: "Evacuate…" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
});

test("with canManage, Online members can be evacuated, Evacuated ones restored, Offline ones neither", async () => {
  mockApi({ "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)] });
  renderInventory(true);
  expect(within(await rowOf("node1")).getByRole("button", { name: "Evacuate…" })).toBeInTheDocument();
  expect(within(await rowOf("node2")).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  const offline = await rowOf("node3");
  expect(within(offline).queryByRole("button")).not.toBeInTheDocument();
  expect(document.querySelectorAll("th.ic-col-actions, td.ic-col-actions")).toHaveLength(4);
});

test("the evacuate dialog offers the four modes, defaulting to the cluster's", async () => {
  mockApi({ "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)] });
  renderInventory(true);
  await userEvent.click(within(await rowOf("node1")).getByRole("button", { name: "Evacuate…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Evacuate node1" })).toBeInTheDocument();
  const mode = within(dialog).getByLabelText("Mode");
  expect(mode).toHaveValue("auto");
  expect(within(mode).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Cluster default (cluster.evacuate)",
    "Move instances",
    "Move instances live (VMs that support it)",
    "Stop instances",
  ]);
});

test("evacuating with the cluster default sends an empty body and lands on the job", async () => {
  const api = mockApi({
    "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)],
    "POST /api/v1/clusters/c-1/members/node1/evacuate": [202, job],
  });
  renderInventory(true);
  await userEvent.click(within(await rowOf("node1")).getByRole("button", { name: "Evacuate…" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Evacuate" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  const post = api.calls.find((c) => c.method === "POST")!;
  expect(post.path).toBe("/api/v1/clusters/c-1/members/node1/evacuate");
  expect(post.body).toEqual({});
});

test("evacuating with Stop instances sends the mode", async () => {
  const api = mockApi({
    "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)],
    "POST /api/v1/clusters/c-1/members/node1/evacuate": [202, job],
  });
  renderInventory(true);
  await userEvent.click(within(await rowOf("node1")).getByRole("button", { name: "Evacuate…" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.selectOptions(within(dialog).getByLabelText("Mode"), "Stop instances");
  await userEvent.click(within(dialog).getByRole("button", { name: "Evacuate" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ mode: "stop" });
});

test("restoring confirms first, then posts and lands on the job", async () => {
  const api = mockApi({
    "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)],
    "POST /api/v1/clusters/c-1/members/node2/restore": [202, { ...job, type: "restore-member" }],
  });
  renderInventory(true);
  await userEvent.click(within(await rowOf("node2")).getByRole("button", { name: "Restore" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Restore node2?" })).toBeInTheDocument();
  expect(within(dialog).getByText("Instances that left it come back, and it takes new ones again.")).toBeInTheDocument();
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  const post = api.calls.find((c) => c.method === "POST")!;
  expect(post.path).toBe("/api/v1/clusters/c-1/members/node2/restore");
  expect(post.body).toBeUndefined();
});

test("a failed restore shows the API message and stays on the page", async () => {
  mockApi({
    "GET /api/v1/clusters/c-1/inventory": [200, inventory(members)],
    "POST /api/v1/clusters/c-1/members/node2/restore": [409, { error: { code: "conflict", message: "node2 is not evacuated any more" } }],
  });
  renderInventory(true);
  await userEvent.click(within(await rowOf("node2")).getByRole("button", { name: "Restore" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
  expect(await screen.findByText("node2 is not evacuated any more")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("job page")).not.toBeInTheDocument();
});
