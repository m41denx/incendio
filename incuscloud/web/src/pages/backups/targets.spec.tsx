import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { BackupTarget, PlatformRole } from "../../api/types";
import TargetList from "./TargetList";

const primary: BackupTarget = {
  id: "bt-1",
  name: "eu-main",
  endpoint: "https://s3.eu.example.com",
  region: "eu-west-1",
  bucket: "incus-backups",
  prefix: "prod",
  accessKeyId: "AKIAEU",
  enabled: true,
  createdAt: "2026-10-01T00:00:00Z",
};
const archive: BackupTarget = {
  id: "bt-2",
  name: "archive",
  endpoint: "https://s3.example.com",
  bucket: "cold",
  accessKeyId: "AKIAARC",
  enabled: false,
  createdAt: "2026-10-02T00:00:00Z",
};

const page = (role: PlatformRole | null = "admin", routes: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: role })],
    "GET /api/v1/backup-targets": [200, [primary, archive]],
    ...routes,
  });

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

test("admins see every target's settings and state, with the actions", async () => {
  page();
  renderAt(<TargetList />, { path: "/backup-targets" });
  const row = await waitForRow("eu-main");
  expect(within(row).getByText("https://s3.eu.example.com")).toBeInTheDocument();
  expect(within(row).getByText("incus-backups/prod")).toBeInTheDocument();
  expect(within(row).getByText("AKIAEU")).toBeInTheDocument();
  expect(within(row).getByText("Enabled")).toHaveClass("p-status-label--positive");
  expect(within(row).getByRole("button", { name: "Check" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Edit…" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Disable" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  const off = await waitForRow("archive");
  expect(within(off).getByText("cold")).toBeInTheDocument();
  expect(within(off).getByText("Disabled")).not.toHaveClass("p-status-label--positive");
  expect(within(off).getByRole("button", { name: "Enable" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add target" })).toBeInTheDocument();
});

test("a member without a platform role sees the notice and no table", async () => {
  const api = page(null);
  renderAt(<TargetList />, { path: "/backup-targets" });
  expect(await screen.findByText("Only platform staff see backup targets.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(api.calls.some((c) => c.path.startsWith("/api/v1/backup-targets"))).toBe(false);
});

test("operators see the table but no way to change targets", async () => {
  page("operator");
  renderAt(<TargetList />, { path: "/backup-targets" });
  await screen.findByText("eu-main");
  for (const b of ["Add target", "Check", "Edit…", "Disable", "Enable", "Delete"]) expect(screen.queryByRole("button", { name: b })).not.toBeInTheDocument();
});

test("adding a target posts its fields and leaves out the empty optional ones", async () => {
  const api = page("admin", { "POST /api/v1/backup-targets": [201, { ...primary, id: "bt-3", name: "lab" }] });
  renderAt(<TargetList />, { path: "/backup-targets" });
  await userEvent.click(await screen.findByRole("button", { name: "Add target" }));
  const dialog = within(await screen.findByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("Name"), "lab");
  await userEvent.type(dialog.getByLabelText("Endpoint"), "https://s3.lab.test");
  await userEvent.type(dialog.getByLabelText("Bucket"), "lab-backups");
  await userEvent.type(dialog.getByLabelText("Access key ID"), "AKIALAB");
  await userEvent.type(dialog.getByLabelText("Secret key"), "s3cr3t");
  await userEvent.click(dialog.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
    name: "lab",
    endpoint: "https://s3.lab.test",
    bucket: "lab-backups",
    accessKeyId: "AKIALAB",
    secretKey: "s3cr3t",
  });
});

test("editing sends only the changed fields and no secret key when it is left empty", async () => {
  const api = page("admin", { "PATCH /api/v1/backup-targets/bt-1": [200, primary] });
  renderAt(<TargetList />, { path: "/backup-targets" });
  await userEvent.click(within(await waitForRow("eu-main")).getByRole("button", { name: "Edit…" }));
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(dialog.getByLabelText("Secret key")).toHaveValue("");
  await userEvent.clear(dialog.getByLabelText("Region"));
  await userEvent.type(dialog.getByLabelText("Region"), "eu-central-1");
  await userEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
  expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ region: "eu-central-1" });
});

test("editing sends the secret key when one is typed", async () => {
  const api = page("admin", { "PATCH /api/v1/backup-targets/bt-1": [200, primary] });
  renderAt(<TargetList />, { path: "/backup-targets" });
  await userEvent.click(within(await waitForRow("eu-main")).getByRole("button", { name: "Edit…" }));
  const dialog = within(await screen.findByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("Secret key"), "rotated");
  await userEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
  expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ secretKey: "rotated" });
});

test("a target that does not answer says why", async () => {
  page("admin", {
    "POST /api/v1/backup-targets/bt-1/check": [200, { ok: false, error: "Target: InvalidAccessKeyId: The access key does not exist" }],
  });
  renderAt(<TargetList />, { path: "/backup-targets" });
  await userEvent.click(within(await waitForRow("eu-main")).getByRole("button", { name: "Check" }));
  expect(await screen.findByText("eu-main does not answer")).toBeInTheDocument();
  expect(screen.getByText(/InvalidAccessKeyId/)).toBeInTheDocument();
});

test("deleting a target that backups use shows the refusal", async () => {
  page("admin", {
    "DELETE /api/v1/backup-targets/bt-1": [409, { error: { code: "conflict", message: "Backups or policies still use this target" } }],
  });
  renderAt(<TargetList />, { path: "/backup-targets" });
  await userEvent.click(within(await waitForRow("eu-main")).getByRole("button", { name: "Delete" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("Backups or policies still use this target")).toBeInTheDocument();
});

test("disabling a target sends enabled false", async () => {
  const api = page("admin", { "PATCH /api/v1/backup-targets/bt-1": [200, { ...primary, enabled: false }] });
  renderAt(<TargetList />, { path: "/backup-targets" });
  await userEvent.click(within(await waitForRow("eu-main")).getByRole("button", { name: "Disable" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
  expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ enabled: false });
});

/** The row once the list has loaded. */
async function waitForRow(name: string) {
  await screen.findByText(name);
  return rowOf(name);
}
