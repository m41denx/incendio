import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { Instance } from "../../api/types";
import BackupNow from "./BackupNow";
import BackupSchedule from "./BackupSchedule";

const instance = { id: "i-1", clusterId: "c-1", clusterName: "lab", project: "acme", name: "web", tenantId: "t-1", tenantSlug: "acme", type: "container", status: "Running" } as Instance;
const tenantAdmin = me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "admin" }] });
const operator = me({ platformRole: "operator" });
const targets = [
  { id: "bt-1", name: "nightly-s3" },
  { id: "bt-2", name: "archive" },
];

/** The modal over the instance page, with the job and backups pages as the routes it navigates to. */
function show(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/instances/i-1"]}>
        <Routes>
          <Route path="/instances/:id" element={ui} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
          <Route path="/backups" element={<p>backups page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const optionsOf = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

test("a tenant admin backs up to the first target, with snapshots, and the job opens", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/instances/i-1/backups": [202, { id: "j-7", type: "backup", state: "queued" }],
  });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  expect(await screen.findByRole("heading", { name: "Back up web" })).toBeInTheDocument();
  await screen.findByRole("option", { name: "archive" });
  expect(screen.getByLabelText("Target")).toHaveValue("bt-1");
  expect(screen.getByLabelText("Without snapshots")).not.toBeChecked();
  // Tenant admins are not operators: no transport choice.
  expect(screen.queryByLabelText("Transport")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Back up" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ targetId: "bt-1", instanceOnly: false });
});

test("Without snapshots sends instanceOnly", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/instances/i-1/backups": [202, { id: "j-7", type: "backup", state: "queued" }],
  });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  await screen.findByRole("option", { name: "archive" });
  await userEvent.selectOptions(screen.getByLabelText("Target"), "bt-2");
  await userEvent.click(screen.getByLabelText("Without snapshots"));
  await userEvent.click(screen.getByRole("button", { name: "Back up" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ targetId: "bt-2", instanceOnly: true });
});

test("an operator chooses a transport, and choosing relay sends it", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, operator],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/instances/i-1/backups": [202, { id: "j-7", type: "backup", state: "queued" }],
  });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  const transport = await screen.findByLabelText("Transport");
  expect(optionsOf(transport)).toEqual(["Automatic", "Uploaded by the cluster", "Through the control plane"]);
  await userEvent.selectOptions(transport, "relay");
  await userEvent.click(screen.getByRole("button", { name: "Back up" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ targetId: "bt-1", instanceOnly: false, transport: "relay" });
});

test("an operator's automatic transport is not sent", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, operator],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/instances/i-1/backups": [202, { id: "j-7", type: "backup", state: "queued" }],
  });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  await screen.findByLabelText("Transport");
  await userEvent.click(screen.getByRole("button", { name: "Back up" }));
  expect(await screen.findByText("job page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ targetId: "bt-1", instanceOnly: false });
});

test("disabled targets are not offered", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/backup-targets": [200, [{ id: "bt-1", name: "nightly-s3", enabled: true }, { id: "bt-2", name: "archive", enabled: false }]],
  });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  const select = await screen.findByLabelText("Target");
  await waitFor(() => expect(optionsOf(select)).toEqual(["nightly-s3"]));
});

test("with no targets the modal says so and cannot submit", async () => {
  const api = mockApi({ "GET /api/v1/me": [200, tenantAdmin], "GET /api/v1/backup-targets": [200, []] });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  expect(await screen.findByText("No backup target is set up yet. Platform admins add them under Backup targets.")).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "Back up" });
  expect(submit).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(submit);
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
});

test("a 409 from the API is shown and the modal stays open", async () => {
  mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/instances/i-1/backups": [409, { error: { code: "conflict", message: "the instance is busy" } }],
  });
  show(<BackupNow instance={instance} onClose={() => {}} />);
  await screen.findByRole("option", { name: "archive" });
  await userEvent.click(screen.getByRole("button", { name: "Back up" }));
  expect(await screen.findByText("the instance is busy")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Back up web" })).toBeInTheDocument();
});

test("a schedule posts the full body with numbers and opens the instance's backups", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/backup-policies": [201, { id: "bp-1" }],
  });
  show(<BackupSchedule instance={instance} onClose={() => {}} />);
  expect(await screen.findByRole("heading", { name: "Schedule backups of web" })).toBeInTheDocument();
  await screen.findByRole("option", { name: "archive" });
  expect(screen.getByLabelText("Every")).toHaveValue("86400");
  expect(screen.getByLabelText("Keep")).toHaveValue(7);
  expect(screen.getByText("The newest backups kept; older ones are deleted")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Target"), "bt-2");
  await userEvent.selectOptions(screen.getByLabelText("Every"), "21600");
  await userEvent.clear(screen.getByLabelText("Keep"));
  await userEvent.type(screen.getByLabelText("Keep"), "14");
  await userEvent.click(screen.getByLabelText("Without snapshots"));
  await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
  expect(await screen.findByText("backups page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ instanceId: "i-1", targetId: "bt-2", intervalS: 21600, keep: 14, instanceOnly: true });
});

test("a schedule with the defaults sends a day's interval and seven kept", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/backup-policies": [201, { id: "bp-1" }],
  });
  show(<BackupSchedule instance={instance} onClose={() => {}} />);
  await screen.findByRole("option", { name: "archive" });
  await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
  expect(await screen.findByText("backups page")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ instanceId: "i-1", targetId: "bt-1", intervalS: 86400, keep: 7, instanceOnly: false });
});

test("a schedule keep that is empty or out of range is not posted", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/backup-policies": [201, { id: "bp-1" }],
  });
  show(<BackupSchedule instance={instance} onClose={() => {}} />);
  await screen.findByRole("option", { name: "archive" });
  await userEvent.clear(screen.getByLabelText("Keep"));
  await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
  expect(await screen.findByText("Keep must be a whole number from 1 to 365.")).toBeInTheDocument();
  // Out of range: the browser's min/max check stops the submit.
  await userEvent.type(screen.getByLabelText("Keep"), "400");
  // The button keeps its spinner for a moment after a failed attempt.
  await waitFor(() => expect(screen.getByRole("button", { name: "Create schedule" })).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  expect(screen.getByRole("heading", { name: "Schedule backups of web" })).toBeInTheDocument();
});

test("a schedule with no targets says so and cannot submit", async () => {
  const api = mockApi({ "GET /api/v1/me": [200, tenantAdmin], "GET /api/v1/backup-targets": [200, []] });
  show(<BackupSchedule instance={instance} onClose={() => {}} />);
  expect(await screen.findByText("No backup target is set up yet. Platform admins add them under Backup targets.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create schedule" })).toHaveAttribute("aria-disabled", "true");
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
});

test("a schedule 409 is shown and the modal stays open", async () => {
  mockApi({
    "GET /api/v1/me": [200, tenantAdmin],
    "GET /api/v1/backup-targets": [200, targets],
    "POST /api/v1/backup-policies": [409, { error: { code: "conflict", message: "This instance already has a policy for that target" } }],
  });
  show(<BackupSchedule instance={instance} onClose={() => {}} />);
  await screen.findByRole("option", { name: "archive" });
  await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
  expect(await screen.findByText("This instance already has a policy for that target")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Schedule backups of web" })).toBeInTheDocument();
});
