import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { Cluster, Job, Me } from "../../api/types";
import JobDetail from "./JobDetail";
import JobList from "./JobList";

const cluster = (id: string, name: string): Cluster => ({
  id,
  name,
  url: `https://${name}.test:8443`,
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
});
const clusters = [cluster("c-1", "edge-1"), cluster("c-2", "edge-2")];

const job = (over: Partial<Job> = {}): Job => ({
  id: "j-1",
  type: "migrate",
  state: "running",
  progress: { stage: "transfer", percent: 40, message: "copying disk" },
  payload: {
    sourceClusterId: "c-1",
    sourceProject: "acme",
    name: "web",
    targetClusterId: "c-2",
    targetProject: "acme",
    targetName: "web",
    mode: "move",
    live: false,
    transport: "direct",
  },
  result: null,
  error: "",
  tenantId: "t-1",
  clusterIds: ["c-1", "c-2"],
  instanceKey: null,
  actorType: "user",
  actorId: "u-1",
  cancelRequested: false,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ...over,
});

const member: Me["tenants"] = [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }];
const ownUser = () => me({ id: "u-1", platformRole: null, tenants: [] });

/** The table row of a job, found by its link to /jobs/<id>. */
const jobRow = async (id: string): Promise<HTMLElement> => {
  await waitFor(() => expect(document.querySelector(`a[href="/jobs/${id}"]`)).not.toBeNull());
  return document.querySelector<HTMLElement>(`a[href="/jobs/${id}"]`)!.closest("tr")!;
};

const FAILED_ERROR = "Could not copy the disk: the target pool has no room for the 42 GiB volume of the web instance.";

test("job rows show the summary, state badge and progress", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [
      200,
      [
        job({ id: "j-1" }),
        job({ id: "j-2", type: "replicate", state: "succeeded", progress: { stage: "done" }, payload: { policyId: "rp-1" }, finishedAt: new Date().toISOString() }),
        job({ id: "j-3", state: "failed", progress: { stage: "transfer" }, error: FAILED_ERROR, finishedAt: new Date().toISOString() }),
      ],
    ],
  });
  renderAt(<JobList />, { path: "/jobs" });

  const running = await jobRow("j-1");
  expect(within(running).getByRole("link", { name: "Move acme/web (edge-1) → acme/web (edge-2)" })).toHaveAttribute("href", "/jobs/j-1");
  expect(within(running).getByText("Running")).toHaveClass("p-status-label--information");
  expect(within(running).getByText("transfer — copying disk")).toBeInTheDocument();

  const replication = await jobRow("j-2");
  expect(within(replication).getByText("Succeeded")).toHaveClass("p-status-label--positive");
  expect(replication.querySelector('a[href="/jobs/j-2"]')).toHaveTextContent("Replication run");
  expect(replication.querySelector('a[href="/replication"]')).toHaveTextContent("Replication run");

  const failed = await jobRow("j-3");
  expect(within(failed).getByText("Failed")).toHaveClass("p-status-label--negative");
  const error = within(failed).getByTitle(FAILED_ERROR);
  expect(error).toHaveClass("ic-negative");
  expect(error).toHaveTextContent(FAILED_ERROR.slice(0, 80) + "…");
});

test("the list says so when there are no jobs", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [200, []],
  });
  renderAt(<JobList />, { path: "/jobs" });
  expect(await screen.findByText("No jobs yet.")).toBeInTheDocument();
});

test("a cluster the caller cannot list falls back to a short id", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: member })],
    "GET /api/v1/clusters": [403, { error: { code: "forbidden", message: "Not allowed" } }],
    "GET /api/v1/jobs": [200, [job({ id: "j-1", payload: { ...job().payload, sourceClusterId: "c-1000000001", targetClusterId: "c-2000000002" } })]],
  });
  renderAt(<JobList />, { path: "/jobs" });
  const row = await jobRow("j-1");
  expect(within(row).getByRole("link", { name: "Move acme/web (c-100000…) → acme/web (c-200000…)" })).toBeInTheDocument();
});

test("the State and Type filters go into the query", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [200, []],
  });
  renderAt(<JobList />, { path: "/jobs" });
  await screen.findByText("No jobs yet.");
  await userEvent.selectOptions(screen.getByLabelText("State"), "failed");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/jobs") && c.path.includes("state=failed"))).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText("Type"), "failover");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/jobs") && c.path.includes("state=failed") && c.path.includes("type=failover"))).toBe(true));
});

test("Cancel is shown to the job's actor on a running job and posts /cancel", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [200, [job({ id: "j-1", actorId: "u-1" })]],
    "POST /api/v1/jobs/j-1/cancel": [202, job({ id: "j-1", cancelRequested: true })],
  });
  renderAt(<JobList />, { path: "/jobs" });
  const row = await jobRow("j-1");
  await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
  const dialog = await screen.findByRole("dialog", { name: "Cancel this job?" });
  const confirm = within(dialog).getAllByRole("button", { name: "Cancel" }).at(-1)!;
  await userEvent.click(confirm);
  await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/v1/jobs/j-1/cancel")).toBe(true));
});

test("Cancel is hidden from a tenant member who did not start the job", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ id: "u-1", platformRole: null, tenants: member })],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [200, [job({ id: "j-1", actorId: "u-2", tenantId: "t-1" })]],
  });
  renderAt(<JobList />, { path: "/jobs" });
  const row = await jobRow("j-1");
  expect(within(row).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

test("Cancel is shown to a tenant admin for a job someone else started", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ id: "u-1", platformRole: null, tenants: [{ ...member[0]!, role: "admin" }] })],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [200, [job({ id: "j-1", actorId: "u-2", tenantId: "t-1" })]],
  });
  renderAt(<JobList />, { path: "/jobs" });
  const row = await jobRow("j-1");
  expect(within(row).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
});

test("Cancel is hidden on finished jobs", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs": [200, [job({ id: "j-1", actorId: "u-1", state: "succeeded", progress: { stage: "done" }, finishedAt: new Date().toISOString() })]],
  });
  renderAt(<JobList />, { path: "/jobs" });
  const row = await jobRow("j-1");
  expect(within(row).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

test("the detail shows a migration's result", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs/j-2": [
      200,
      job({
        id: "j-2",
        state: "succeeded",
        progress: { stage: "done" },
        finishedAt: new Date().toISOString(),
        payload: { ...job().payload, mode: "copy", targetProject: "beta", targetName: "web-copy" },
        result: { transport: "direct", targetClusterId: "c-2", targetProject: "beta", targetName: "web-copy" },
      }),
    ],
  });
  renderAt(<JobDetail />, { path: "/jobs/j-2", pattern: "/jobs/:id" });
  expect(await screen.findByText("Target: beta/web-copy")).toBeInTheDocument();
  expect(screen.getByText("Transport: direct")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
  expect(screen.getByText("Succeeded")).toHaveClass("p-status-label--positive");
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  // The last stage of a job that succeeded says nothing.
  expect(screen.queryByText("done")).not.toBeInTheDocument();
});

test("the detail shows a failed job's error", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs/j-3": [200, job({ id: "j-3", state: "failed", progress: { stage: "transfer" }, error: FAILED_ERROR, finishedAt: new Date().toISOString() })],
  });
  renderAt(<JobDetail />, { path: "/jobs/j-3", pattern: "/jobs/:id" });
  expect(await screen.findByText(FAILED_ERROR)).toHaveClass("ic-negative");
  expect(screen.getByText("Failed")).toHaveClass("p-status-label--negative");
  expect(screen.getByText("Stopped at")).toBeInTheDocument();
  expect(screen.getByText("transfer")).toBeInTheDocument();
});

test("the detail cancels a running job the caller started", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs/j-1": [200, job({ id: "j-1", actorId: "u-1" })],
    "POST /api/v1/jobs/j-1/cancel": [202, job({ id: "j-1", cancelRequested: true })],
  });
  renderAt(<JobDetail />, { path: "/jobs/j-1", pattern: "/jobs/:id" });
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  const dialog = await screen.findByRole("dialog", { name: "Cancel this job?" });
  await userEvent.click(within(dialog).getAllByRole("button", { name: "Cancel" }).at(-1)!);
  await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/v1/jobs/j-1/cancel")).toBe(true));
});

test("an unknown or invisible job is not found", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs/j-9": [404, { error: { code: "not_found", message: "Job not found" } }],
  });
  renderAt(<JobDetail />, { path: "/jobs/j-9", pattern: "/jobs/:id" });
  expect(await screen.findByText("Not found")).toBeInTheDocument();
});

test("backup and restore jobs read as such, with their results", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs/j-5": [200, job({ id: "j-5", type: "restore", state: "succeeded", finishedAt: new Date().toISOString(), payload: { backupId: "b-1", targetClusterId: "c-2", targetProject: "acme", targetName: "web-r", start: true }, result: { targetClusterId: "c-2", targetProject: "acme", targetName: "web-r" } })],
  });
  renderAt(<JobDetail />, { path: "/jobs/j-5", pattern: "/jobs/:id" });
  expect(await screen.findByText(/Restore to acme\/web-r \(edge-2\)/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Restore" })).toHaveAttribute("href", "/backups");
  expect(screen.getByText("Restored as acme/web-r")).toBeInTheDocument();
});

test("a backup job's summary and result", async () => {
  mockApi({
    "GET /api/v1/me": [200, ownUser()],
    "GET /api/v1/clusters": [200, clusters],
    "GET /api/v1/jobs/j-6": [200, job({ id: "j-6", type: "backup", state: "succeeded", finishedAt: new Date().toISOString(), payload: { clusterId: "c-1", project: "acme", instanceName: "web", targetId: "t", instanceOnly: false, transport: "auto" }, result: { backupId: "b-9", transport: "direct", sizeBytes: 4718592, pruned: 1, warnings: [] } })],
  });
  renderAt(<JobDetail />, { path: "/jobs/j-6", pattern: "/jobs/:id" });
  expect(await screen.findByText(/Back up acme\/web \(edge-1\)/)).toBeInTheDocument();
  expect(screen.getByText("4.5 MiB, uploaded by the cluster")).toBeInTheDocument();
  expect(screen.getByText("1 older backup deleted")).toBeInTheDocument();
});
