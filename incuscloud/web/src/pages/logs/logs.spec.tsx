import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { AuditEntry, Cluster, GatewayRequest, Tenant } from "../../api/types";
import AuditLog from "./AuditLog";
import GatewayLog from "./GatewayLog";

const acme: Tenant = { id: "t-1", slug: "acme", name: "Acme", quotas: {}, createdAt: "2026-10-01T00:00:00Z" };
const beta: Tenant = { id: "t-2", slug: "beta", name: "Beta", quotas: {}, createdAt: "2026-10-01T00:00:00Z" };
const edge: Cluster = {
  id: "c-1",
  name: "edge-1",
  url: "https://edge-1.test:8443",
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
};

const audit = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  at: "2026-10-10T10:00:00Z",
  actorType: "user",
  actorId: "u-1234567890",
  action: "tenant.create",
  targetType: "tenant",
  targetId: "t-1-0000000000",
  result: "success",
  detail: { slug: "acme" },
  ip: "10.0.0.1",
  ...over,
});

const gateway = (over: Partial<GatewayRequest>): GatewayRequest => ({
  id: 1,
  at: "2026-10-10T10:00:00Z",
  clusterId: "c-1",
  actorType: "user",
  actorId: "u-1234567890",
  method: "GET",
  path: "/api/v1/instances",
  status: 200,
  bytesIn: 0,
  bytesOut: 512,
  durationMs: 42,
  ip: "10.0.0.1",
  ...over,
});

const row = (text: string) => screen.findByText(text).then((el) => el.closest("tr")!);

test("audit rows render, and the Failed label appears for a failed row", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme, beta]],
    "GET /api/v1/audit": [
      200,
      [
        audit({ id: 2, action: "cluster.enroll", result: "denied", targetType: "cluster", targetId: "c-9999999999" }),
        audit({ id: 1, action: "tenant.create", result: "success" }),
      ],
    ],
  });
  renderAt(<AuditLog />, { path: "/audit" });
  const failed = await row("cluster.enroll");
  expect(within(failed).getByText("Failed")).toBeInTheDocument();
  expect(within(failed).getByText("c-999999…")).toBeInTheDocument();
  expect(within(failed).getByTitle("c-9999999999")).toBeInTheDocument();
  const ok = await row("tenant.create");
  expect(within(ok).queryByText("Failed")).not.toBeInTheDocument();
  expect(within(ok).getByTitle("u-1234567890")).toHaveTextContent("u-123456");
});

test("clicking an audit row shows its detail as JSON", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/audit": [200, [audit({ id: 2, action: "cluster.enroll", result: "denied", detail: { reason: "quota" } })]],
  });
  renderAt(<AuditLog />, { path: "/audit" });
  await userEvent.click(await screen.findByText("cluster.enroll"));
  expect(await screen.findByText(/"reason": "quota"/)).toBeInTheDocument();
});

test("changing the Action filter calls the API with action=…", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/audit": [200, [audit({})]],
  });
  renderAt(<AuditLog />, { path: "/audit" });
  await screen.findByText("tenant.create");
  await userEvent.type(screen.getByLabelText("Action"), "tenant.create");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/audit") && c.path.includes("action=tenant.create"))).toBe(true));
});

test("a tenant admin who is not a platform viewer gets their tenant in the first request, with no All option", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "admin" }, { id: "t-2", slug: "beta", name: "Beta", role: "member" }] })],
    "GET /api/v1/audit": [200, [audit({})]],
  });
  renderAt(<AuditLog />, { path: "/audit" });
  await screen.findByText("tenant.create");
  const audits = api.calls.filter((c) => c.path.startsWith("/api/v1/audit"));
  expect(audits[0]!.path).toContain("tenant=t-1");
  const scope = screen.getByLabelText("Tenant scope");
  expect(within(scope).queryByRole("option", { name: "All tenants" })).not.toBeInTheDocument();
  expect(within(scope).getByRole("option", { name: "Acme" })).toBeInTheDocument();
  expect(within(scope).queryByRole("option", { name: "Beta" })).not.toBeInTheDocument();
  expect(api.calls.some((c) => c.path === "/api/v1/tenants")).toBe(false);
});

test("Load older requests before=<last id> and appends the rows", async () => {
  const page = (ids: number[]) => ids.map((id) => audit({ id, action: `action.${id}` }));
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/audit": (_body, url) => {
      if (url.searchParams.get("before") === "101") return [200, page([100, 99])];
      return [200, page(Array.from({ length: 100 }, (_, i) => 200 - i))];
    },
  });
  renderAt(<AuditLog />, { path: "/audit" });
  await screen.findByText("action.200");
  await userEvent.click(screen.getByRole("button", { name: "Load older" }));
  expect(await screen.findByText("action.99")).toBeInTheDocument();
  expect(screen.getByText("action.200")).toBeInTheDocument();
  expect(api.calls.some((c) => c.path.includes("before=101"))).toBe(true);
  expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
});

test("gateway rows show the cluster name and human-readable bytes", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/gateway-requests": [200, [gateway({ id: 5, path: "/api/v1/instances/web", method: "PUT", bytesIn: 1048576, status: 500, durationMs: 1234 })]],
  });
  renderAt(<GatewayLog />, { path: "/gateway-log" });
  const r = await row("/api/v1/instances/web");
  expect(within(r).getByText("edge-1")).toBeInTheDocument();
  expect(within(r).getByText("1.0 MiB")).toBeInTheDocument();
  expect(within(r).getByText("512 B")).toBeInTheDocument();
  expect(within(r).getByText("1234")).toBeInTheDocument();
  expect(within(r).getByText("500").querySelector(".p-icon--status-failed-small")).not.toBeNull();
  expect(screen.getByText(/IC_GATEWAY_SAMPLE_READS/)).toHaveClass("u-text--muted");
});

test("the cluster filter goes into the query", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/tenants": [200, [acme]],
    "GET /api/v1/clusters": [200, [edge]],
    "GET /api/v1/gateway-requests": [200, [gateway({})]],
  });
  renderAt(<GatewayLog />, { path: "/gateway-log" });
  await screen.findByText("/api/v1/instances");
  await userEvent.selectOptions(screen.getByLabelText("Cluster"), "c-1");
  await waitFor(() => expect(api.calls.some((c) => c.path.startsWith("/api/v1/gateway-requests") && c.path.includes("cluster=c-1"))).toBe(true));
});
