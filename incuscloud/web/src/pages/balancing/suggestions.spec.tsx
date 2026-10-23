import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { BalancingSuggestion, Instance } from "../../api/types";
import Suggestions from "./Suggestions";

const instance = { id: "i-1", clusterId: "c-1", clusterName: "lab", project: "acme", name: "web", tenantId: "t-1", tenantSlug: "acme", type: "container", status: "Running" } as Instance;

const suggestion = (over: Partial<BalancingSuggestion> = {}): BalancingSuggestion => ({
  tenantId: "t-1",
  tenantSlug: "acme",
  instanceId: "i-1",
  project: "acme",
  name: "web",
  memoryBytes: 2147483648,
  fromClusterId: "c-1",
  fromClusterName: "lab",
  toClusterId: "c-2",
  toClusterName: "edge",
  toProject: "acme",
  reason: "balance",
  ...over,
});

const placements = [
  { clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-2", clusterName: "edge", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
];

type Routes = Parameters<typeof mockApi>[0];

/** The API as the page and the move dialog read it; `routes` override or add answers. */
function api({ suggestions = [], routes = {} }: { suggestions?: BalancingSuggestion[]; routes?: Routes } = {}) {
  return mockApi({
    "GET /api/v1/balancing/suggestions": [200, suggestions],
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] })],
    "GET /api/v1/clusters": [200, []],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "GET /api/v1/instances/i-1": [200, instance],
    // The Rules section lists instances that have balancing rules: none here.
    "GET /1.0/instances": [200, { metadata: [] }],
    ...routes,
  });
}

/** The page, with an instance page as the route the instance link leads to. */
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/balancing"]}>
        <Routes>
          <Route path="/balancing" element={<Suggestions />} />
          <Route path="/instances/:id" element={<p>instance page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui);
}

/** The table row of a suggested instance, found by its link. */
const rowOf = async (text: string) => (await screen.findByRole("link", { name: text })).closest("tr")!;

test("with no suggestions the page says the clusters are evenly loaded", async () => {
  api();
  show();
  expect(await screen.findByText("No suggestions: your clusters are evenly loaded.")).toBeInTheDocument();
  expect(screen.getByText("Balancing")).toBeInTheDocument();
  expect(screen.getByText(/Nothing moves until you start it/)).toBeInTheDocument();
});

test("a suggestion row shows the instance link, tenant, memory, the move, the reason and a Move button", async () => {
  api({ suggestions: [suggestion(), suggestion({ instanceId: "i-2", name: "db", memoryBytes: 512, reason: "anti-affinity" })] });
  show();

  const web = await rowOf("acme/web");
  // The instance opens in the console, on its cluster.
  expect(screen.getByRole("link", { name: "acme/web" })).toHaveAttribute("href", "/ui/project/acme%40lab/instance/web");
  expect(within(web).getByText("acme")).toBeInTheDocument();
  expect(within(web).getByText("2.0 GiB")).toBeInTheDocument();
  expect(within(web).getByText("lab → edge")).toBeInTheDocument();
  expect(within(web).getByText("balance")).toBeInTheDocument();
  expect(within(web).getByRole("button", { name: "Move…" })).toBeInTheDocument();

  const db = await rowOf("acme/db");
  expect(within(db).getByText("512 B")).toBeInTheDocument();
  expect(within(db).getByText("anti-affinity")).toBeInTheDocument();
});

test("Move… fetches the instance and opens the move dialog with the suggested target chosen", async () => {
  const more = [...placements, { clusterId: "c-4", clusterName: "cool", project: "acme", status: "ready", statusMessage: "", createdAt: "" }];
  const client = api({ suggestions: [suggestion({ toClusterId: "c-4", toClusterName: "cool" })], routes: { "GET /api/v1/tenants/t-1/placements": [200, more] } });
  show();

  await userEvent.click(within(await rowOf("acme/web")).getByRole("button", { name: "Move…" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Move or copy web")).toBeInTheDocument();
  expect(client.calls.some((c) => c.method === "GET" && c.path === "/api/v1/instances/i-1")).toBe(true);
  // The suggested cluster is first in the list, so the choice is the suggestion and not the default.
  await within(dialog).findByRole("option", { name: "cool" });
  expect(within(dialog).getByLabelText("Target cluster")).toHaveValue("c-4");
});

test("cancelling the move dialog closes it", async () => {
  api({ suggestions: [suggestion()] });
  show();

  await userEvent.click(within(await rowOf("acme/web")).getByRole("button", { name: "Move…" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a failing instance fetch shows the error and opens no dialog", async () => {
  api({
    suggestions: [suggestion()],
    routes: { "GET /api/v1/instances/i-1": [404, { error: { code: "not_found", message: "No such instance" } }] },
  });
  show();

  await userEvent.click(within(await rowOf("acme/web")).getByRole("button", { name: "Move…" }));
  expect(await screen.findByText("No such instance")).toBeInTheDocument();
  expect(screen.getByText("Not found")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
