import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { Backup, BackupPolicy } from "../../api/types";
import BackupList from "./BackupList";

const targets = [
  { id: "tg-1", name: "s3-main" },
  { id: "tg-2", name: "s3-archive" },
];

const backup = (over: Partial<Backup> = {}): Backup =>
  ({
    id: "b-1",
    tenantId: "t-1",
    policyId: "p-1",
    targetId: "tg-1",
    objectKey: "acme/web/b-1",
    clusterId: "c-1",
    project: "acme",
    instanceName: "web",
    instanceType: "container",
    instanceOnly: false,
    sizeBytes: 1536,
    state: "ready",
    error: "",
    jobId: null,
    transport: "",
    createdBy: "u-1",
    createdAt: new Date().toISOString(),
    completedAt: null,
    targetName: "s3-main",
    clusterName: "prod",
    ...over,
  }) as Backup;

const policy = (over: Partial<BackupPolicy> = {}): BackupPolicy => ({
  id: "p-1",
  tenantId: "t-1",
  clusterId: "c-1",
  project: "acme",
  instanceName: "web",
  targetId: "tg-1",
  intervalS: 3600,
  keep: 7,
  instanceOnly: false,
  enabled: true,
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
const placements = [{ clusterId: "c-1", clusterName: "prod", project: "acme", status: "ready", statusMessage: "", createdAt: "" }];

type Routes = Parameters<typeof mockApi>[0];

/** The API as the page reads it, with the given rows; `routes` override or add answers. */
function api({ user = acmeAdmin, backups = [], policies = [], routes = {} }: { user?: ReturnType<typeof me>; backups?: Backup[]; policies?: BackupPolicy[]; routes?: Routes } = {}) {
  return mockApi({
    "GET /api/v1/me": [200, user],
    "GET /api/v1/clusters": [200, []],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "GET /api/v1/backups": [200, backups],
    "GET /api/v1/backup-policies": [200, policies],
    "GET /api/v1/backup-targets": [200, targets],
    ...routes,
  });
}

/** The page, with the job page as the route a run or a restore leads to. */
function show(path = "/backups") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backups" element={<BackupList />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui);
}

/** The backup row of an instance, found by its name in the instance column. */
const backupRow = async (name: string) => (await screen.findByText(`acme/${name}`, { selector: "span.ic-mono" })).closest("tr")!;
/** The schedule row of an instance, found the same way. */
const policyRow = async (name: string) => (await screen.findByText(`acme/${name}`, { selector: "span.ic-mono" })).closest("tr")!;

test("backup rows show the instance and its cluster, the size, how it was made, the target and the state", async () => {
  api({
    backups: [
      backup({ id: "b-1", instanceName: "web", sizeBytes: 1536, policyId: "p-1", clusterName: "prod" }),
      backup({ id: "b-2", instanceName: "db", sizeBytes: null, policyId: null, clusterName: null, targetName: "s3-archive" }),
      backup({ id: "b-3", instanceName: "app", state: "failed", error: "quota exceeded", policyId: null }),
      backup({ id: "b-4", instanceName: "cache", state: "creating", sizeBytes: null, policyId: null }),
    ],
  });
  show();
  expect(await screen.findByRole("heading", { name: "Backups", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Schedules", level: 2 })).toBeInTheDocument();

  const web = await backupRow("web");
  expect(within(web).getByText("prod")).toBeInTheDocument();
  expect(within(web).getByText("1.5 KiB")).toBeInTheDocument();
  expect(within(web).getByText("scheduled")).toBeInTheDocument();
  expect(within(web).getByText("s3-main")).toBeInTheDocument();
  expect(within(web).getByText("Ready")).toBeInTheDocument();

  const db = await backupRow("db");
  expect(within(db).getByText("removed cluster")).toBeInTheDocument();
  expect(within(db).getByText("by hand")).toBeInTheDocument();
  expect(within(db).getByText("—")).toBeInTheDocument();
  expect(within(db).getByText("s3-archive")).toBeInTheDocument();

  const app = await backupRow("app");
  expect(within(app).getByText("Failed")).toHaveAttribute("title", "quota exceeded");

  expect(within(await backupRow("cache")).getByText("Creating")).toBeInTheDocument();
});

test("the empty lists say what to do", async () => {
  api();
  show();
  expect(await screen.findByText("No backups yet. Back an instance up from its page.")).toBeInTheDocument();
  expect(screen.getByText("No schedules yet.")).toBeInTheDocument();
});

test("the instance filter is sent to the API and shown, with a link back to all backups", async () => {
  const client = api({ backups: [backup({ instanceName: "web" })] });
  show("/backups?instance=i-1");
  await backupRow("web");
  expect(client.calls.some((c) => c.method === "GET" && c.path === "/api/v1/backups?instance=i-1")).toBe(true);
  expect(screen.getByText(/Backups of one instance/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "show all" })).toHaveAttribute("href", "/backups");
});

test("without a filter, the page lists every backup and shows no filter line", async () => {
  const client = api({ backups: [backup()] });
  show();
  await backupRow("web");
  expect(client.calls.some((c) => c.path === "/api/v1/backups")).toBe(true);
  expect(screen.queryByText(/Backups of one instance/)).not.toBeInTheDocument();
});

test("Restore opens the restore dialog for a ready backup the caller manages", async () => {
  api({ backups: [backup({ instanceName: "web", tenantId: "t-1" }), backup({ id: "b-2", instanceName: "other", tenantId: "t-2" })] });
  show();
  await userEvent.click(within(await backupRow("web")).getByRole("button", { name: "Restore…" }));
  expect(await screen.findByRole("heading", { name: "Restore web" })).toBeInTheDocument();
});

test("a backup of another tenant gets no actions for a tenant admin", async () => {
  api({ backups: [backup({ instanceName: "theirs", tenantId: "t-2" })] });
  show();
  const row = await backupRow("theirs");
  expect(within(row).queryByRole("button", { name: "Restore…" })).not.toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});

test("a creating backup has no Restore and a disabled Delete", async () => {
  api({ backups: [backup({ instanceName: "cache", state: "creating", sizeBytes: null })] });
  show();
  const row = await backupRow("cache");
  expect(within(row).queryByRole("button", { name: "Restore…" })).not.toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
});

test("Delete asks first, then removes the backup and refreshes the list", async () => {
  const client = api({
    backups: [backup({ instanceName: "web", targetName: "s3-main" })],
    routes: { "DELETE /api/v1/backups/b-1": [204] },
  });
  show();
  await userEvent.click(within(await backupRow("web")).getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Delete this backup?" })).toBeInTheDocument();
  expect(within(dialog).getByText(/removed from s3-main/)).toBeInTheDocument();
  expect(client.calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(client.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/backups/b-1")).toBe(true));
  await waitFor(() => expect(client.calls.filter((c) => c.method === "GET" && c.path === "/api/v1/backups").length).toBeGreaterThan(1));
});

test("a member sees backups but no actions", async () => {
  api({
    user: acmeMember,
    backups: [backup({ instanceName: "web", tenantId: "t-1" })],
    policies: [policy({ instanceName: "nightly", tenantId: "t-1" })],
  });
  show();
  await backupRow("web");
  await policyRow("nightly");
  for (const b of ["Restore…", "Delete", "Run now", "Pause", "Resume"]) expect(screen.queryByRole("button", { name: b })).not.toBeInTheDocument();
});

test("schedules show their interval, target, keep count, last backup and state", async () => {
  api({
    policies: [
      policy({ id: "p-1", instanceName: "web", intervalS: 3600, keep: 7 }),
      policy({ id: "p-2", instanceName: "db", intervalS: 86400, keep: 3, enabled: false, lastSuccessAt: null, lastError: "bucket missing" }),
      policy({ id: "p-3", instanceName: "app", intervalS: 604800, targetId: "tg-9abcdef012" }),
      policy({ id: "p-4", instanceName: "cache", intervalS: 5400 }),
    ],
  });
  show();
  const web = await policyRow("web");
  expect(within(web).getByText("1 h")).toBeInTheDocument();
  expect(within(web).getByText("s3-main")).toBeInTheDocument();
  expect(within(web).getByText("7")).toBeInTheDocument();
  expect(within(web).getByText("Active")).toBeInTheDocument();

  const db = await policyRow("db");
  expect(within(db).getByText("1 day")).toBeInTheDocument();
  expect(within(db).getByText("never")).toBeInTheDocument();
  expect(within(db).getByText("Failed")).toHaveAttribute("title", "bucket missing");
  expect(within(db).getByText("Paused")).toBeInTheDocument();

  const app = await policyRow("app");
  expect(within(app).getByText("1 week")).toBeInTheDocument();
  expect(within(app).getByText("tg-9abcd")).toBeInTheDocument();

  expect(within(await policyRow("cache")).getByText("1.5 h")).toBeInTheDocument();
});

test("the empty schedules list says so", async () => {
  api();
  show();
  expect(await screen.findByText("No schedules yet.")).toBeInTheDocument();
});

test("Run now posts to the schedule and links the job it started", async () => {
  const client = api({
    policies: [policy({ id: "p-1", instanceName: "web" })],
    routes: { "POST /api/v1/backup-policies/p-1/run": [202, { id: "j-7", type: "backup", state: "queued" }] },
  });
  show();
  await userEvent.click(within(await policyRow("web")).getByRole("button", { name: "Run now" }));
  expect(await screen.findByText("Backup started")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute("href", "/jobs/j-7");
  expect(client.calls.some((c) => c.method === "POST" && c.path === "/api/v1/backup-policies/p-1/run")).toBe(true);
});

test("a refused run shows the API's message", async () => {
  api({
    policies: [policy({ id: "p-1", instanceName: "web" })],
    routes: { "POST /api/v1/backup-policies/p-1/run": [409, { error: { code: "conflict", message: "a backup is already running" } }] },
  });
  show();
  await userEvent.click(within(await policyRow("web")).getByRole("button", { name: "Run now" }));
  expect(await screen.findByText("a backup is already running")).toBeInTheDocument();
});

test("Pause sends enabled=false and Resume sends enabled=true", async () => {
  const client = api({
    policies: [policy({ id: "p-1", instanceName: "web" }), policy({ id: "p-2", instanceName: "db", enabled: false })],
    routes: {
      "PATCH /api/v1/backup-policies/p-1": (body) => [200, policy({ id: "p-1", enabled: (body as { enabled: boolean }).enabled })],
      "PATCH /api/v1/backup-policies/p-2": (body) => [200, policy({ id: "p-2", instanceName: "db", enabled: (body as { enabled: boolean }).enabled })],
    },
  });
  show();
  await userEvent.click(within(await policyRow("web")).getByRole("button", { name: "Pause" }));
  await waitFor(() => expect(client.calls.find((c) => c.method === "PATCH" && c.path === "/api/v1/backup-policies/p-1")!.body).toEqual({ enabled: false }));
  await userEvent.click(within(await policyRow("db")).getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(client.calls.find((c) => c.method === "PATCH" && c.path === "/api/v1/backup-policies/p-2")!.body).toEqual({ enabled: true }));
});

test("Delete schedule asks first, says its backups are kept, and deletes it", async () => {
  const client = api({
    policies: [policy({ id: "p-1", instanceName: "web" })],
    routes: { "DELETE /api/v1/backup-policies/p-1": [204] },
  });
  show();
  await userEvent.click(within(await policyRow("web")).getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Delete this schedule?" })).toBeInTheDocument();
  expect(within(dialog).getByText("Its backups are kept.")).toBeInTheDocument();
  expect(client.calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(client.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/backup-policies/p-1")).toBe(true));
});
