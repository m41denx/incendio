import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi, renderAt } from "../../test/api";
import type { Member, Tenant, TenantPlacement, User } from "../../api/types";
import TenantList from "./TenantList";
import TenantDetail from "./TenantDetail";

const acme: Tenant = { id: "t-1", slug: "acme", name: "Acme Corp", quotas: { instances: 10, memory: 32 }, createdAt: "2026-10-01T00:00:00Z" };
const beta: Tenant = { id: "t-2", slug: "beta", name: "Beta", quotas: {}, createdAt: "2026-10-02T00:00:00Z" };
const owner: Member = { userId: "u-1", email: "ada@example.com", name: "Ada", role: "owner" };
const dev: Member = { userId: "u-2", email: "bob@example.com", name: "Bob", role: "member" };
const where: TenantPlacement = { clusterId: "c-1", clusterName: "prod", project: "acme", status: "ready", statusMessage: "", createdAt: "2026-10-03T00:00:00Z" };
const users: User[] = [
  { id: "u-1", email: "ada@example.com", name: "Ada", disabled: false, platformRole: null, hasPassword: true, createdAt: "", lastLoginAt: null },
  { id: "u-3", email: "cy@example.com", name: "Cy", disabled: false, platformRole: null, hasPassword: true, createdAt: "", lastLoginAt: null },
];
const memberOf = (role: Member["role"]) => me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme Corp", role }] });
const detail = (who = me(), over: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    "GET /api/v1/me": [200, who],
    "GET /api/v1/tenants/t-1": [200, acme],
    "GET /api/v1/tenants/t-1/members": [200, [owner, dev]],
    "GET /api/v1/tenants/t-1/placements": [200, [where]],
    "GET /api/v1/tenants/t-1/usage": [200, { quota: acme.quotas, used: { instances: 2, cpu: 0, memory: 0, disk: 0 }, clusters: [] }],
    ...over,
  });
const renderDetail = () => renderAt(<TenantDetail />, { path: "/tenants/t-1", pattern: "/tenants/:id" });

test("platform viewers list every tenant with its quotas; operators can create", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: "operator" })], "GET /api/v1/tenants": [200, [acme, beta]] });
  renderAt(<TenantList />);
  const row = (await screen.findByRole("link", { name: "acme" })).closest("tr")!;
  expect(within(row).getByText("Acme Corp")).toBeInTheDocument();
  expect(within(row).getByText("10 instances, 32 GiB memory")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create tenant" })).toBeInTheDocument();
});

test("members see their tenants with their role and cannot create", async () => {
  mockApi({ "GET /api/v1/me": [200, memberOf("member")], "GET /api/v1/tenants": [200, [acme]] });
  renderAt(<TenantList />);
  const row = (await screen.findByRole("link", { name: "acme" })).closest("tr")!;
  expect(within(row).getByText("Member")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create tenant" })).not.toBeInTheDocument();
});

test("operators create a tenant with quotas and an owner, then land on it", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "operator" })],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/users": [200, users],
    "POST /api/v1/tenants": [201, { ...acme, id: "t-9", slug: "gamma", name: "Gamma" }],
    "GET /api/v1/tenants/t-9": [200, { ...acme, id: "t-9", slug: "gamma", name: "Gamma" }],
    "GET /api/v1/tenants/t-9/members": [200, []],
    "GET /api/v1/tenants/t-9/placements": [200, []],
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/tenants"]}>
        <Routes>
          <Route path="/tenants" element={<TenantList />} />
          <Route path="/tenants/:id" element={<TenantDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Create tenant" }));
  await userEvent.type(screen.getByLabelText("Slug"), "gamma");
  await userEvent.type(screen.getByLabelText("Name"), "Gamma");
  await userEvent.type(screen.getByLabelText("Instances"), "5");
  await userEvent.type(screen.getByLabelText("Memory (GiB)"), "16");
  await userEvent.selectOptions(await screen.findByLabelText("Owner"), "u-3");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("heading", { name: /Gamma/ });
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ slug: "gamma", name: "Gamma", quotas: { instances: 5, memory: 16 }, ownerId: "u-3" });
});

test("the detail page shows members, where the tenant runs and its quotas", async () => {
  detail(memberOf("viewer"));
  renderDetail();
  expect(await screen.findByRole("link", { name: "prod" })).toHaveAttribute("href", "/clusters/c-1");
  expect(await screen.findByText("bob@example.com")).toBeInTheDocument();
  // The quota with what is used of it.
  expect(await screen.findByText(/^2 \/ 10 /)).toBeInTheDocument();
  for (const b of ["Add member", "Edit quotas", "Rename", "Delete tenant"]) expect(screen.queryByRole("button", { name: b })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Service accounts" })).not.toBeInTheDocument();
});

test("tenant admins cannot change owners", async () => {
  detail(memberOf("admin"));
  renderDetail();
  await screen.findByLabelText("Role of bob@example.com");
  expect(screen.queryByLabelText("Role of ada@example.com")).not.toBeInTheDocument();
  expect(within(screen.getByLabelText("Role of bob@example.com")).queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
});

test("tenant owners add members by email, change roles and see the last-owner refusal", async () => {
  const api = detail(memberOf("owner"), {
    "POST /api/v1/tenants/t-1/members": [200, { userId: "u-3", role: "viewer" }],
    "PUT /api/v1/tenants/t-1/members/u-2": [200, { userId: "u-2", role: "admin" }],
    "PUT /api/v1/tenants/t-1/members/u-1": [409, { error: { code: "last_owner", message: "A tenant needs at least one owner" } }],
  });
  renderDetail();
  await userEvent.click(await screen.findByRole("button", { name: "Add member" }));
  await userEvent.type(screen.getByLabelText("Email"), "cy@example.com");
  await userEvent.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Role"), "viewer");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ email: "cy@example.com", role: "viewer" }));
  await userEvent.selectOptions(await screen.findByLabelText("Role of bob@example.com"), "admin");
  await waitFor(() => expect(api.calls.find((c) => c.method === "PUT" && c.path.endsWith("/u-2"))?.body).toEqual({ role: "admin" }));
  await userEvent.selectOptions(screen.getByLabelText("Role of ada@example.com"), "member");
  expect(await screen.findByText("A tenant needs at least one owner")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Service accounts" })).toHaveAttribute("href", "/service-accounts?tenant=t-1");
});

test("only platform operators edit quotas", async () => {
  const api = detail(me({ platformRole: "operator" }), { "PATCH /api/v1/tenants/t-1": (b) => [200, { ...acme, ...(b as object) }] });
  renderDetail();
  await userEvent.click(await screen.findByRole("button", { name: "Edit quotas" }));
  const cpu = within(screen.getByRole("dialog")).getByLabelText("CPUs");
  await userEvent.type(cpu, "8");
  const mem = within(screen.getByRole("dialog")).getByLabelText("Memory (GiB)");
  await userEvent.clear(mem);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ quotas: { instances: 10, cpu: 8 } }));
});

test("owners delete; a placed tenant's 409 is explained", async () => {
  detail(memberOf("owner"), { "DELETE /api/v1/tenants/t-1": [409, { error: { code: "tenant_placed", message: "Remove this tenant from its clusters first" } }] });
  renderDetail();
  await userEvent.click(await screen.findByRole("button", { name: "Delete tenant" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete tenant" }));
  expect(await screen.findByText("Remove this tenant from its clusters first")).toBeInTheDocument();
});

test("adding a platform role-holder warns that the tenant role replaces it on this tenant", async () => {
  detail(memberOf("owner"), { "POST /api/v1/tenants/t-1/members": [200, { userId: "u-3", role: "viewer", replacesPlatformRole: "admin" }] });
  renderDetail();
  await userEvent.click(await screen.findByRole("button", { name: "Add member" }));
  await userEvent.type(screen.getByLabelText("Email"), "root@example.com");
  await userEvent.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Role"), "viewer");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
  expect(await screen.findByText(/root@example.com is a platform admin/)).toBeInTheDocument();
});
