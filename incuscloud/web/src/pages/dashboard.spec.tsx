import { expect, test } from "vitest";
import { screen, within } from "@testing-library/react";
import { me, mockApi, renderAt } from "../test/api";
import type { Cluster, Tenant, User } from "../api/types";
import Dashboard from "./Dashboard";

const cluster = (over: Partial<Cluster>): Cluster => ({
  id: "c-1",
  name: "prod",
  url: "https://prod.clusters.test:8443",
  addresses: [],
  fingerprint: "",
  status: "ready",
  statusMessage: "",
  labels: {},
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  lastSeenAt: "2026-10-11T00:00:00Z",
  reconciledAt: "2026-10-11T00:00:00Z",
  reconcileRequestedAt: null,
  ...over,
});
const tenant = (over: Partial<Tenant>): Tenant => ({ id: "t-1", slug: "acme", name: "Acme", quotas: {}, createdAt: "2026-10-01T00:00:00Z", ...over });
const user = (over: Partial<User>): User => ({ id: "u-1", email: "ada@example.com", name: "Ada", disabled: false, platformRole: "admin", hasPassword: true, createdAt: "2026-10-01T00:00:00Z", lastLoginAt: null, ...over });

test("counts come from the clusters, tenants and users APIs", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [cluster({ id: "c-1", name: "prod" }), cluster({ id: "c-2", name: "edge", status: "degraded", statusMessage: "2 nodes unreachable" }), cluster({ id: "c-3", name: "lab" })]],
    "GET /api/v1/tenants": [200, [tenant({ id: "t-1" }), tenant({ id: "t-2", slug: "globex", name: "Globex" })]],
    "GET /api/v1/users": [200, [user({ id: "u-1" }), user({ id: "u-2", email: "bob@example.com", name: "Bob", platformRole: null }), user({ id: "u-3", name: "Cy" }), user({ id: "u-4", name: "Di" })]],
  });
  renderAt(<Dashboard />);
  expect(await within(screen.getByRole("region", { name: "Clusters" })).findByText("2 ready · 1 degraded")).toBeInTheDocument();
  expect(await within(screen.getByRole("region", { name: "Clusters" })).findByText("3")).toBeInTheDocument();
  expect(await within(screen.getByRole("region", { name: "Tenants" })).findByText("2")).toBeInTheDocument();
  expect(await within(screen.getByRole("region", { name: "Users" })).findByText("4")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Clusters" })).toHaveAttribute("href", "/clusters");
  expect(screen.getByRole("link", { name: "Tenants" })).toHaveAttribute("href", "/tenants");
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/users");
});

test("a degraded cluster is listed under Needs attention with its message", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [cluster({ id: "c-1", name: "prod" }), cluster({ id: "c-2", name: "edge", status: "degraded", statusMessage: "2 nodes unreachable" })]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/users": [200, []],
  });
  renderAt(<Dashboard />);
  const attention = screen.getByRole("region", { name: "Needs attention" });
  expect(await within(attention).findByRole("link", { name: "edge" })).toHaveAttribute("href", "/clusters/c-2");
  expect(within(attention).getByText("Degraded")).toBeInTheDocument();
  expect(within(attention).getByText("2 nodes unreachable")).toBeInTheDocument();
  expect(within(attention).queryByRole("link", { name: "prod" })).not.toBeInTheDocument();
});

test("when every cluster is ready the section says so", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [cluster({ id: "c-1", name: "prod" }), cluster({ id: "c-2", name: "lab" })]],
    "GET /api/v1/tenants": [200, []],
    "GET /api/v1/users": [200, []],
  });
  renderAt(<Dashboard />);
  expect(await screen.findByText("All clusters are healthy.")).toBeInTheDocument();
});

test("with no clusters, platform admins are offered enrolment", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, []], "GET /api/v1/tenants": [200, []], "GET /api/v1/users": [200, []] });
  renderAt(<Dashboard />);
  expect(await screen.findByRole("link", { name: "Enrol a cluster" })).toHaveAttribute("href", "/clusters");
});

test("a tenant member never asks for users and sees no Users card", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] })],
    "GET /api/v1/clusters": [200, [cluster({ id: "c-1", name: "prod" })]],
    "GET /api/v1/tenants": [200, [tenant({ id: "t-1" })]],
  });
  renderAt(<Dashboard />);
  expect(await within(screen.getByRole("region", { name: "Tenants" })).findByText("1")).toBeInTheDocument();
  expect(await within(screen.getByRole("region", { name: "Clusters" })).findByText("1 ready")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Users" })).not.toBeInTheDocument();
  expect(api.calls.some((c) => c.path.startsWith("/api/v1/users"))).toBe(false);
});

test("My tenants lists the caller's memberships with their role", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "owner" }] })],
    "GET /api/v1/clusters": [200, []],
    "GET /api/v1/tenants": [200, [tenant({ id: "t-1" })]],
  });
  renderAt(<Dashboard />);
  const mine = await screen.findByRole("region", { name: "My tenants" });
  expect(within(mine).getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/tenants/t-1");
  expect(within(mine).getByText("owner")).toBeInTheDocument();
});
