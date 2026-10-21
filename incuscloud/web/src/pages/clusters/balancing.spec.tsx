import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockApi } from "../../test/api";
import type { BalancingPlan, BalancingPolicy } from "../../api/types";
import ClusterBalancing from "./ClusterBalancing";

const policy = (over: Partial<BalancingPolicy> = {}): BalancingPolicy => ({
  clusterId: "c-1",
  enabled: true,
  method: "memory",
  mode: "used",
  balanciness: 10,
  intervalS: 900,
  maxMoves: 5,
  allowRestart: false,
  excludeMembers: [],
  excludeProjects: [],
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: "",
  lastJobId: null,
  ...over,
});

const renderBalancing = (canManage: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/clusters/c-1"]}>
        <Routes>
          <Route path="/clusters/:id" element={<ClusterBalancing clusterId="c-1" canManage={canManage} />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** The value cell of a summary row. */
const value = (key: string) => screen.getByText(key).nextElementSibling as HTMLElement;

test("the summary reads a saved policy in words", async () => {
  mockApi({
    "GET /api/v1/clusters/c-1/balancing": [
      200,
      policy({
        method: "cpu",
        mode: "assigned",
        intervalS: 5400,
        balanciness: 12,
        maxMoves: 3,
        allowRestart: true,
        excludeMembers: ["node2"],
        excludeProjects: ["ci", "db"],
        lastRunAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    ],
  });
  renderBalancing(false);
  await screen.findByText("Every 90 min");
  expect(screen.getByRole("region", { name: "Balancing" })).toBeInTheDocument();
  expect(value("Automatic")).toHaveTextContent("Every 90 min");
  expect(value("Balance by")).toHaveTextContent("CPU assigned");
  expect(value("Tolerated spread")).toHaveTextContent("12 points");
  expect(value("At most")).toHaveTextContent("3 moves per run");
  expect(value("Running instances")).toHaveTextContent("Moved with a restart when needed");
  expect(value("Excluded members")).toHaveTextContent("node2");
  expect(value("Excluded projects")).toHaveTextContent("ci, db");
  expect(value("Last run")).toHaveTextContent("5 min ago");
});

test("hours, off, defaults and a failed last run", async () => {
  mockApi({
    "GET /api/v1/clusters/c-1/balancing": [200, policy({ enabled: false, intervalS: 3600, lastError: "node2: instance busy" })],
  });
  renderBalancing(false);
  await screen.findByText("Automatic");
  expect(value("Automatic")).toHaveTextContent("Off");
  expect(value("Balance by")).toHaveTextContent("memory used");
  expect(value("Running instances")).toHaveTextContent("Only VMs that can move live");
  expect(value("Excluded members")).toHaveTextContent("None");
  expect(value("Excluded projects")).toHaveTextContent("None");
  expect(screen.getByText("never")).toBeInTheDocument();
  expect(screen.getByText("node2: instance busy")).toBeInTheDocument();
});

test("viewers see the summary and no buttons", async () => {
  mockApi({ "GET /api/v1/clusters/c-1/balancing": [200, policy()] });
  renderBalancing(false);
  await screen.findByText("Balance by");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("operators get the settings, preview and rebalance buttons", async () => {
  mockApi({ "GET /api/v1/clusters/c-1/balancing": [200, policy()] });
  renderBalancing(true);
  await screen.findByText("Balance by");
  const section = screen.getByRole("region", { name: "Balancing" });
  for (const b of ["Settings…", "Preview", "Rebalance now"]) expect(within(section).getByRole("button", { name: b })).toBeInTheDocument();
});

test("the settings form saves minutes as seconds and comma lists as arrays, then refetches", async () => {
  let saved = policy();
  const api = mockApi({
    "GET /api/v1/clusters/c-1/balancing": () => [200, saved],
    "PUT /api/v1/clusters/c-1/balancing": (body) => {
      saved = { ...saved, ...(body as BalancingPolicy) };
      return [200, saved];
    },
  });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Settings…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Balancing settings" }));
  await userEvent.clear(dialog.getByLabelText("Every (minutes)"));
  await userEvent.type(dialog.getByLabelText("Every (minutes)"), "30");
  await userEvent.selectOptions(dialog.getByLabelText("Balance by"), "cpu");
  await userEvent.selectOptions(dialog.getByLabelText("Measure"), "assigned");
  await userEvent.clear(dialog.getByLabelText("Tolerated spread (points)"));
  await userEvent.type(dialog.getByLabelText("Tolerated spread (points)"), "15");
  await userEvent.clear(dialog.getByLabelText("Moves per run"));
  await userEvent.type(dialog.getByLabelText("Moves per run"), "2");
  await userEvent.click(dialog.getByLabelText("Allow restarts"));
  await userEvent.type(dialog.getByLabelText("Excluded members"), " node1, node2 ,, ");
  await userEvent.type(dialog.getByLabelText("Excluded projects"), "ci");
  await userEvent.click(dialog.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
  expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
    enabled: true,
    intervalS: 1800,
    method: "cpu",
    mode: "assigned",
    balanciness: 15,
    maxMoves: 2,
    allowRestart: true,
    excludeMembers: ["node1", "node2"],
    excludeProjects: ["ci"],
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(value("Automatic")).toHaveTextContent("Every 30 min"));
  expect(api.calls.filter((c) => c.method === "GET" && c.path.endsWith("/balancing")).length).toBeGreaterThanOrEqual(2);
});

test("the settings cannot be saved with an interval outside 5 to 1440 minutes", async () => {
  mockApi({ "GET /api/v1/clusters/c-1/balancing": [200, policy()] });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Settings…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Balancing settings" }));
  const save = dialog.getByRole("button", { name: "Save" });
  expect(save).not.toHaveAttribute("aria-disabled", "true");

  await userEvent.clear(dialog.getByLabelText("Every (minutes)"));
  await userEvent.type(dialog.getByLabelText("Every (minutes)"), "4");
  expect(save).toHaveAttribute("aria-disabled", "true");

  await userEvent.clear(dialog.getByLabelText("Every (minutes)"));
  await userEvent.type(dialog.getByLabelText("Every (minutes)"), "1441");
  expect(save).toHaveAttribute("aria-disabled", "true");

  await userEvent.clear(dialog.getByLabelText("Every (minutes)"));
  await userEvent.type(dialog.getByLabelText("Every (minutes)"), "1440");
  expect(save).not.toHaveAttribute("aria-disabled", "true");
});

test("preview shows the spread, the notes and each move with its reason", async () => {
  const plan: BalancingPlan = {
    before: 14.04,
    after: 3.2,
    moves: [
      { project: "acme", name: "web-1", from: "node1", to: "node3", reason: "balance" },
      { project: "beta", name: "db", from: "node2", to: "node1", reason: "anti-affinity" },
    ],
    notes: ["node2 is offline; its instances stay put.", "2 instances are pinned."],
  };
  const api = mockApi({
    "GET /api/v1/clusters/c-1/balancing": [200, policy()],
    "POST /api/v1/clusters/c-1/balancing/plan": [200, plan],
  });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Preview" }));

  expect(await screen.findByText("Spread now: 14.0 points; after: 3.2 points")).toBeInTheDocument();
  expect(screen.getByText("node2 is offline; its instances stay put.")).toHaveClass("u-text--muted");
  expect(screen.getByText("2 instances are pinned.")).toHaveClass("u-text--muted");

  for (const h of ["Instance", "From", "To", "Why"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
  const web = screen.getByRole("row", { name: /acme\/web-1/ });
  expect(within(web).getByText("node1")).toBeInTheDocument();
  expect(within(web).getByText("node3")).toBeInTheDocument();
  expect(within(web).getByText("Balance")).toBeInTheDocument();
  const db = screen.getByRole("row", { name: /beta\/db/ });
  expect(within(db).getByText("Keep apart")).toBeInTheDocument();

  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({});
});

test("a plan with no moves says so", async () => {
  mockApi({
    "GET /api/v1/clusters/c-1/balancing": [200, policy()],
    "POST /api/v1/clusters/c-1/balancing/plan": [200, { before: 4, after: 4, moves: [], notes: [] } satisfies BalancingPlan],
  });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Spread now: 4.0 points; after: 4.0 points")).toBeInTheDocument();
  expect(screen.getByText("Nothing to move.")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Instance" })).not.toBeInTheDocument();
});

test("a failed preview shows its message", async () => {
  mockApi({
    "GET /api/v1/clusters/c-1/balancing": [200, policy()],
    "POST /api/v1/clusters/c-1/balancing/plan": [400, { error: { code: "no_members", message: "Cluster has no online members" } }],
  });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Cluster has no online members")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Instance" })).not.toBeInTheDocument();
});

test("rebalance now opens the job it started", async () => {
  const api = mockApi({
    "GET /api/v1/clusters/c-1/balancing": [200, policy()],
    "POST /api/v1/clusters/c-1/balancing/run": [202, { id: "job-7", type: "rebalance", state: "running" }],
  });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Rebalance now" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/v1/clusters/c-1/balancing/run")).toBe(true);
});

test("a run that is already going shows why it did not start", async () => {
  mockApi({
    "GET /api/v1/clusters/c-1/balancing": [200, policy()],
    "POST /api/v1/clusters/c-1/balancing/run": [409, { error: { code: "run_in_progress", message: "A rebalance is already running" } }],
  });
  renderBalancing(true);
  await userEvent.click(await screen.findByRole("button", { name: "Rebalance now" }));
  expect(await screen.findByText("A rebalance is already running")).toBeInTheDocument();
  expect(screen.queryByText("job page")).not.toBeInTheDocument();
});
