import { expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { me, mockApi, renderAt } from "../../test/api";
import type { Instance, MetricSample } from "../../api/types";
import InstanceDetail from "./InstanceDetail";

const instance = (over: Partial<Instance> = {}): Instance => ({
  id: "i-1",
  clusterId: "c-1",
  clusterName: "lab",
  project: "acme",
  name: "web-1",
  tenantId: "t-1",
  tenantSlug: "acme",
  type: "container",
  status: "Running",
  location: "n1",
  description: "Front end",
  architecture: "x86_64",
  createdAt: "2026-10-01T10:00:00Z",
  imageOs: "Ubuntu",
  imageRelease: "noble",
  limitsCpu: "2",
  limitsMemory: "1GiB",
  cpuCores: 0.25,
  memoryUsed: 512 * 1024 * 1024,
  memoryTotal: 1024 * 1024 * 1024,
  diskUsed: null,
  netRxBps: 2048,
  netTxBps: 1024,
  addresses: ["10.0.0.5", "fd42::5"],
  seenAt: new Date().toISOString(),
  inventoryAt: new Date().toISOString(),
  ...over,
});
const sample = (s: number, cpu: number | null): MetricSample => ({ at: new Date(Date.UTC(2026, 9, 11, 12, 0, s)).toISOString(), cpuCores: cpu, memoryUsed: 100, netRxBps: 10, netTxBps: 5 });

test("an instance's facts, its console link and its charts", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/instances/i-1": [200, instance()],
    "GET /api/v1/instances/i-1/metrics": [200, { samples: [sample(0, null), sample(60, 0.5), sample(120, 0.25)] }],
  });
  renderAt(<InstanceDetail />, { path: "/instances/i-1", pattern: "/instances/:id" });
  expect(await screen.findByText("Front end")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "lab" })).toHaveAttribute("href", "/clusters/c-1");
  expect(screen.getByRole("link", { name: "acme" })).toHaveAttribute("href", "/tenants/t-1");
  expect(screen.getByText("10.0.0.5, fd42::5")).toBeInTheDocument();
  expect(screen.getByText("Ubuntu noble")).toBeInTheDocument();
  expect(screen.getByText("2 CPUs, 1GiB")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open in console" })).toHaveAttribute("href", "/clusters/lab/ui/project/acme/instance/web-1");
  for (const name of [/^CPU: /, /^Memory: /, /^Network in: /, /^Network out: /]) expect(await screen.findByRole("img", { name })).toBeInTheDocument();
  expect(api.calls.some((c) => c.path === "/api/v1/instances/i-1/metrics?hours=24")).toBe(true);
});

test("a project outside any tenant and no limits", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "viewer" })],
    "GET /api/v1/instances/i-1": [200, instance({ tenantId: null, tenantSlug: null, project: "default", limitsCpu: "", limitsMemory: "", imageOs: "", imageRelease: "", addresses: [] })],
    "GET /api/v1/instances/i-1/metrics": [200, { samples: [] }],
  });
  renderAt(<InstanceDetail />, { path: "/instances/i-1", pattern: "/instances/:id" });
  expect(await screen.findByText("default")).toBeInTheDocument();
  expect(screen.getByText("No limits")).toBeInTheDocument();
  expect(screen.getAllByText("No data yet")).toHaveLength(4);
});

test("an instance the caller cannot see is not found", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/instances/i-9": [404, { error: { code: "not_found", message: "Instance not found" } }],
    "GET /api/v1/instances/i-9/metrics": [404, { error: { code: "not_found", message: "Instance not found" } }],
  });
  renderAt(<InstanceDetail />, { path: "/instances/i-9", pattern: "/instances/:id" });
  expect(await screen.findByText("Not found")).toBeInTheDocument();
});
