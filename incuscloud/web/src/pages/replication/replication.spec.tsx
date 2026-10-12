import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { Instance, ReplicationPolicy } from "../../api/types";
import PolicyList from "./PolicyList";
import CreatePolicy from "./CreatePolicy";

const clusters = [
  { id: "c-1", name: "prod" },
  { id: "c-2", name: "edge" },
  { id: "c-3", name: "lab" },
];

const policy = (over: Partial<ReplicationPolicy> = {}): ReplicationPolicy => ({
  id: "p-1",
  tenantId: null,
  sourceClusterId: "c-1",
  sourceProject: "default",
  instanceName: "web",
  targetClusterId: "c-2",
  targetProject: "default",
  targetName: "web-copy",
  intervalS: 900,
  enabled: true,
  state: "active",
  lastRunAt: new Date().toISOString(),
  lastSuccessAt: new Date().toISOString(),
  lastError: "",
  lastJobId: null,
  createdBy: "u-1",
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

const acmeMember = me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] });
const acmeAdmin = me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "admin" }] });

/** The list, with the job page as a route so failover's redirect can be seen. */
function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/replication"]}>
        <Routes>
          <Route path="/replication" element={<PolicyList />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The row of a replica, found by its target name (in the replica column's path). */
const rowOf = async (name: string) => (await screen.findByText(name, { exact: false, selector: "span.mono-font" })).closest("tr")!;

test("rows show the interval, the last copy's failure and the state", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [
      200,
      [
        policy({ id: "p-1", targetName: "web-copy", intervalS: 900 }),
        policy({ id: "p-2", targetName: "db-copy", instanceName: "db", intervalS: 86400, enabled: false, lastSuccessAt: null, lastError: "quota exceeded" }),
        policy({ id: "p-3", targetName: "app-copy", instanceName: "app", intervalS: 3600, state: "failed-over" }),
      ],
    ],
  });
  renderList();
  expect(screen.getByRole("heading", { name: "Replication" })).toBeInTheDocument();
  expect(within(await rowOf("web-copy")).getByText("15 min")).toBeInTheDocument();
  expect(within(await rowOf("web-copy")).getByText("Active")).toBeInTheDocument();
  expect(within(await rowOf("web-copy")).getByText("edge")).toBeInTheDocument();

  const db = await rowOf("db-copy");
  expect(within(db).getByText("1 day")).toBeInTheDocument();
  expect(within(db).getByText("Paused")).toBeInTheDocument();
  expect(within(db).getByText("never")).toBeInTheDocument();
  expect(within(db).getByText("Failed")).toHaveAttribute("title", "quota exceeded");

  const app = await rowOf("app-copy");
  expect(within(app).getByText("1 h")).toBeInTheDocument();
  expect(within(app).getByText("Failed over")).toBeInTheDocument();
});

test("the empty list says how to make a policy", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, clusters], "GET /api/v1/replication-policies": [200, []] });
  renderList();
  expect(await screen.findByText("No replication policies yet. Create one from an instance's page.")).toBeInTheDocument();
});

test("Run now posts to the policy's run endpoint and links the job", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy()]],
    "POST /api/v1/replication-policies/p-1/run": [202, { id: "j-7", type: "replicate", state: "queued" }],
  });
  renderList();
  await userEvent.click(await within(await rowOf("web-copy")).findByRole("button", { name: "Run now" }));
  expect(await screen.findByRole("link", { name: "View job" })).toHaveAttribute("href", "/jobs/j-7");
  expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/v1/replication-policies/p-1/run")).toBe(true);
});

test("a failed run shows the API's message", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy()]],
    "POST /api/v1/replication-policies/p-1/run": [409, { error: { code: "conflict", message: "a run is already active" } }],
  });
  renderList();
  await userEvent.click(await within(await rowOf("web-copy")).findByRole("button", { name: "Run now" }));
  expect(await screen.findByText("a run is already active")).toBeInTheDocument();
});

test("Pause sends enabled=false and Resume sends enabled=true", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy(), policy({ id: "p-2", targetName: "db-copy", enabled: false })]],
    "PATCH /api/v1/replication-policies/p-1": (body) => [200, policy({ enabled: (body as { enabled: boolean }).enabled })],
    "PATCH /api/v1/replication-policies/p-2": (body) => [200, policy({ id: "p-2", enabled: (body as { enabled: boolean }).enabled })],
  });
  renderList();
  await userEvent.click(await within(await rowOf("web-copy")).findByRole("button", { name: "Pause" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH" && c.path === "/api/v1/replication-policies/p-1")!.body).toEqual({ enabled: false }));
  await userEvent.click(within(await rowOf("db-copy")).getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH" && c.path === "/api/v1/replication-policies/p-2")!.body).toEqual({ enabled: true }));
});

test("failover stops the source by default and opens the job", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy()]],
    "POST /api/v1/replication-policies/p-1/failover": [202, { id: "j-9", type: "failover", state: "queued" }],
  });
  renderList();
  await userEvent.click(await within(await rowOf("web-copy")).findByRole("button", { name: "Fail over…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Fail over to the replica?" })).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Stop the source instance first")).toBeChecked();
  await userEvent.click(within(dialog).getByRole("button", { name: "Fail over…" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.path === "/api/v1/replication-policies/p-1/failover")!.body).toEqual({ stopSource: true });
});

test("failover without stopping the source sends stopSource=false", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy()]],
    "POST /api/v1/replication-policies/p-1/failover": [202, { id: "j-9", type: "failover", state: "queued" }],
  });
  renderList();
  await userEvent.click(await within(await rowOf("web-copy")).findByRole("button", { name: "Fail over…" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByLabelText("Stop the source instance first"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Fail over…" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.path === "/api/v1/replication-policies/p-1/failover")!.body).toEqual({ stopSource: false });
});

test("delete asks first, says the replica is kept, and removes the policy", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy()]],
    "DELETE /api/v1/replication-policies/p-1": [204],
  });
  renderList();
  await userEvent.click(await within(await rowOf("web-copy")).findByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/replica instance is kept/)).toBeInTheDocument();
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/replication-policies/p-1")).toBe(true));
});

test("a failed-over policy offers no run, pause or failover", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/replication-policies": [200, [policy({ state: "failed-over" })]],
  });
  renderList();
  const row = await rowOf("web-copy");
  await within(row).findByText("Failed over");
  for (const b of ["Run now", "Pause", "Resume", "Fail over…"]) expect(within(row).queryByRole("button", { name: b })).not.toBeInTheDocument();
});

test("tenant members only read; tenant admins manage their own tenant's policies", async () => {
  const mine = policy({ id: "p-1", tenantId: "t-1", targetName: "mine-copy" });
  const other = policy({ id: "p-2", tenantId: "t-2", targetName: "theirs-copy" });
  const member = mockApi({ "GET /api/v1/me": [200, acmeMember], "GET /api/v1/clusters": [200, clusters], "GET /api/v1/replication-policies": [200, [mine, other]] });
  const { unmount } = renderList();
  await within(await rowOf("mine-copy")).findByText("Active");
  for (const b of ["Run now", "Pause", "Fail over…", "Delete"]) expect(screen.queryByRole("button", { name: b })).not.toBeInTheDocument();
  expect(member.calls.some((c) => c.method !== "GET")).toBe(false);
  unmount();

  mockApi({ "GET /api/v1/me": [200, acmeAdmin], "GET /api/v1/clusters": [200, clusters], "GET /api/v1/replication-policies": [200, [mine, other]] });
  renderList();
  const admin = await rowOf("mine-copy");
  expect(within(admin).getByRole("button", { name: "Run now" })).toBeInTheDocument();
  expect(within(admin).getByRole("button", { name: "Pause" })).toBeInTheDocument();
  expect(within(await rowOf("theirs-copy")).queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  expect(within(await rowOf("theirs-copy")).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

const instance = { id: "i-1", clusterId: "c-1", clusterName: "prod", project: "acme", name: "web", tenantId: "t-1", tenantSlug: "acme", type: "container", status: "Running" } as Instance;

/** The modal, with the list as the route it navigates to after a create. */
function showCreate(i: Instance = instance, onClose = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/instances/i-1"]}>
        <Routes>
          <Route path="/instances/:id" element={<CreatePolicy instance={i} onClose={onClose} />} />
          <Route path="/replication" element={<p>policies page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const placements = [
  { clusterId: "c-1", clusterName: "prod", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-2", clusterName: "edge", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-3", clusterName: "lab", project: "acme", status: "pending", statusMessage: "", createdAt: "" },
];

test("a tenant admin picks among the tenant's other ready placements and posts the policy", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, acmeAdmin],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "POST /api/v1/replication-policies": [201, policy()],
    "GET /api/v1/replication-policies": [200, []],
  });
  showCreate();
  expect(await screen.findByRole("heading", { name: "Replicate web" })).toBeInTheDocument();
  const select = await screen.findByLabelText("Target cluster");
  await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a cluster", "edge"]));
  expect(screen.getByLabelText("Replica name")).toHaveValue("web");
  expect(screen.getByLabelText("Every")).toHaveValue("3600");
  await userEvent.selectOptions(select, "c-2");
  await userEvent.click(screen.getByRole("button", { name: "Create policy" }));
  expect(await screen.findByText("policies page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST" && c.path === "/api/v1/replication-policies")!.body).toEqual({ instanceId: "i-1", targetClusterId: "c-2", targetName: "web", intervalS: 3600 });
});

test("the replica name and interval are sent as chosen", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, acmeAdmin],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "POST /api/v1/replication-policies": [201, policy()],
    "GET /api/v1/replication-policies": [200, []],
  });
  showCreate();
  await screen.findByRole("option", { name: "edge" });
  await userEvent.selectOptions(screen.getByLabelText("Target cluster"), "c-2");
  await userEvent.clear(screen.getByLabelText("Replica name"));
  await userEvent.type(screen.getByLabelText("Replica name"), "web-dr");
  await userEvent.selectOptions(screen.getByLabelText("Every"), "86400");
  await userEvent.click(screen.getByRole("button", { name: "Create policy" }));
  await screen.findByText("policies page");
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ instanceId: "i-1", targetClusterId: "c-2", targetName: "web-dr", intervalS: 86400 });
});

test("a 409 from the API is shown and the modal stays open", async () => {
  mockApi({
    "GET /api/v1/me": [200, acmeAdmin],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "POST /api/v1/replication-policies": [409, { error: { code: "conflict", message: "already replicates to that cluster" } }],
  });
  showCreate();
  await screen.findByRole("option", { name: "edge" });
  await userEvent.selectOptions(screen.getByLabelText("Target cluster"), "c-2");
  await userEvent.click(screen.getByRole("button", { name: "Create policy" }));
  expect(await screen.findByText("already replicates to that cluster")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Replicate web" })).toBeInTheDocument();
});

test("platform operators pick any cluster but the instance's own", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: "operator" })], "GET /api/v1/clusters": [200, clusters] });
  showCreate();
  const select = await screen.findByLabelText("Target cluster");
  await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a cluster", "edge", "lab"]));
});

test("with no other cluster to replicate to, the modal says so and cannot submit", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, acmeAdmin],
    "GET /api/v1/tenants/t-1/placements": [200, [placements[0]]],
  });
  showCreate();
  expect(await screen.findByText("No other cluster to replicate to: the tenant must be placed on another cluster.")).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "Create policy" });
  expect(submit).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(submit);
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
});
