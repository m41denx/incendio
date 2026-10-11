import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { ServiceAccount, ServiceAccountSecret, Tenant } from "../../api/types";
import ServiceAccountList from "./ServiceAccountList";

const acme: Tenant = { id: "t1", slug: "acme", name: "Acme", quotas: {}, createdAt: "2026-10-01T00:00:00Z" };
const globex: Tenant = { id: "t2", slug: "globex", name: "Globex", quotas: {}, createdAt: "2026-10-01T00:00:00Z" };
const ci: ServiceAccount = { id: "sa-1", name: "CI", clientId: "cid-ci", tenantId: "t1", platformRole: null, disabled: false, createdBy: "u-1", createdAt: "2026-10-02T00:00:00Z" };
const ops: ServiceAccount = { id: "sa-2", name: "Monitoring", clientId: "cid-mon", tenantId: null, platformRole: "operator", disabled: false, createdBy: "u-1", createdAt: "2026-10-03T00:00:00Z" };
const secret = (over: Partial<ServiceAccountSecret> = {}): ServiceAccountSecret => ({
  ...ci,
  id: "sa-new",
  name: "Deploy",
  clientId: "cid-new",
  clientSecret: "sec-very-secret-value",
  tokenUrl: "https://cloud.test/api/v1/tokens",
  ...over,
});

test("the list shows accounts with their tenant slug or platform role as scope", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/tenants": [200, [acme, globex]], "GET /api/v1/service-accounts": [200, [ci, ops]] });
  renderAt(<ServiceAccountList />, { path: "/service-accounts" });
  const row = (await screen.findByText("cid-ci")).closest("tr")!;
  expect(within(row).getByText("CI")).toBeInTheDocument();
  expect(within(row).getByText("Tenant acme")).toBeInTheDocument();
  const platformRow = screen.getByText("cid-mon").closest("tr")!;
  expect(within(platformRow).getByText("Platform operator")).toBeInTheDocument();
});

test("?tenant= shows only that tenant's accounts and offers to show all", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/tenants": [200, [acme, globex]], "GET /api/v1/service-accounts": [200, [ci, ops]] });
  renderAt(<ServiceAccountList />, { path: "/service-accounts?tenant=t1" });
  await screen.findByText("cid-ci");
  expect(screen.queryByText("cid-mon")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Show all" })).toHaveAttribute("href", "/service-accounts");
});

test("admins create a tenant account: the body is name and tenantId, then the secret is shown once", async () => {
  let created = false;
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme, globex]],
    "GET /api/v1/service-accounts": () => [200, created ? [ci, { ...ci, id: "sa-new", name: "Deploy", clientId: "cid-new" }] : [ci]],
    "POST /api/v1/service-accounts": () => {
      created = true;
      return [201, secret({ tenantId: "t2", platformRole: null })];
    },
  });
  renderAt(<ServiceAccountList />, { path: "/service-accounts" });
  await userEvent.click(await screen.findByRole("button", { name: "Create service account" }));
  await userEvent.type(screen.getByLabelText("Name"), "Deploy");
  await userEvent.selectOptions(screen.getByLabelText("For"), "t2");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  const dialog = await screen.findByRole("dialog", { name: "Save the secret now" });
  expect(within(dialog).getByText("sec-very-secret-value")).toHaveClass("ic-secret");
  expect(within(dialog).getByText("https://cloud.test/api/v1/tokens")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Deploy", tenantId: "t2" });
  expect(screen.queryByLabelText("Platform role")).not.toBeInTheDocument();
});

test("admins create a platform account with a platform role", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/service-accounts": [200, []],
    "POST /api/v1/service-accounts": [201, secret({ tenantId: null, platformRole: "operator" })],
  });
  renderAt(<ServiceAccountList />, { path: "/service-accounts" });
  await userEvent.click(await screen.findByRole("button", { name: "Create service account" }));
  await userEvent.type(screen.getByLabelText("Name"), "Monitoring");
  await userEvent.selectOptions(screen.getByLabelText("For"), "Platform (no tenant)");
  await userEvent.selectOptions(screen.getByLabelText("Platform role"), "operator");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("sec-very-secret-value")).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Monitoring", platformRole: "operator" });
});

test("Done closes the secret and it is no longer in the document", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/service-accounts": [200, [ci]],
    "POST /api/v1/service-accounts": [201, secret({ tenantId: "t1", platformRole: null })],
  });
  renderAt(<ServiceAccountList />, { path: "/service-accounts" });
  await userEvent.click(await screen.findByRole("button", { name: "Create service account" }));
  await userEvent.type(screen.getByLabelText("Name"), "Deploy");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await userEvent.click(await screen.findByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(document.body.textContent).not.toContain("sec-very-secret-value");
});

test("rotate asks first, then shows the new secret", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/service-accounts": [200, [ci]],
    "POST /api/v1/service-accounts/sa-1/rotate": [200, secret({ id: "sa-1", name: "CI", clientId: "cid-ci", tenantId: "t1", platformRole: null, clientSecret: "sec-rotated-value" })],
  });
  renderAt(<ServiceAccountList />, { path: "/service-accounts" });
  await userEvent.click(await screen.findByRole("button", { name: "Rotate secret" }));
  const dialog = await screen.findByRole("dialog");
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Rotate secret" }));
  expect(await screen.findByText("sec-rotated-value")).toBeInTheDocument();
  expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

test("a tenant member gets no create button", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t1", slug: "acme", name: "Acme", role: "member" }] })],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/service-accounts": [200, [ci]],
  });
  renderAt(<ServiceAccountList />, { path: "/service-accounts" });
  await screen.findByText("cid-ci");
  expect(screen.queryByRole("button", { name: "Create service account" })).not.toBeInTheDocument();
});

test("platform viewers read accounts but get no rotate or delete", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "viewer" })],
    "GET /api/v1/service-accounts": [200, [{ id: "sa-1", name: "ci", clientId: "cid-ci", tenantId: null, platformRole: "viewer", disabled: false, createdBy: null, createdAt: "2026-10-01T00:00:00Z" }]],
    "GET /api/v1/tenants": [200, []],
  });
  renderAt(<ServiceAccountList />);
  await screen.findByText("cid-ci");
  expect(screen.queryByRole("button", { name: "Rotate secret" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});
