import { expect, test } from "vitest";
import { screen, within } from "@testing-library/react";
import { mockApi, renderAt } from "../../test/api";
import type { TenantUsage as Usage } from "../../api/types";
import TenantUsage from "./TenantUsage";

const GiB = 1024 ** 3;

const usage = (over: Partial<Usage> = {}): Usage => ({
  quota: { instances: 3, cpu: 4, memory: 2, disk: 10 },
  used: { instances: 2, cpu: 1, memory: GiB, disk: 5 * GiB },
  clusters: [],
  ...over,
});

const renderUsage = (u: Usage) => {
  const api = mockApi({ "GET /api/v1/tenants/t-1/usage": [200, u] });
  renderAt(<TenantUsage tenantId="t-1" />, { path: "/tenants/t-1", pattern: "/tenants/:id" });
  return api;
};

/** The value cell of a summary row, found by its row heading. */
const summaryRow = (label: string) => screen.getByRole("rowheader", { name: label }).nextElementSibling as HTMLElement;

/** The cells of a cluster's table row, found by its cluster link. */
const clusterRow = async (name: string) => {
  const link = await screen.findByRole("link", { name });
  return within(link.closest("tr") as HTMLElement)
    .getAllByRole("gridcell")
    .map((c) => c.textContent);
};

test("with quota keys, each summary row is a meter of used against the quota", async () => {
  renderUsage(usage());
  expect(await screen.findByRole("meter", { name: "Instances used" })).toHaveAttribute("aria-valuetext", "2 / 3 (67%)");
  expect(screen.getByRole("meter", { name: "CPUs used" })).toHaveAttribute("aria-valuetext", "1 / 4 (25%)");
  expect(screen.getByRole("meter", { name: "Memory used" })).toHaveAttribute("aria-valuetext", "1.0 GiB / 2.0 GiB (50%)");
  expect(screen.getByRole("meter", { name: "Disk used" })).toHaveAttribute("aria-valuetext", "5.0 GiB / 10.0 GiB (50%)");
  expect(summaryRow("Instances").querySelector('[role="meter"]')).not.toBeNull();
  expect(screen.getByRole("rowheader", { name: "CPUs" })).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "Memory" })).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "Disk" })).toBeInTheDocument();
});

test("without a quota key, the summary row shows the used amount and no limit", async () => {
  renderUsage(usage({ quota: { instances: 3 }, used: { instances: 3, cpu: 2, memory: 2 * GiB, disk: 0 } }));
  expect(await screen.findByRole("meter", { name: "Instances used" })).toHaveAttribute("aria-valuetext", "3 / 3 (100%)");
  expect(summaryRow("CPUs").textContent).toBe("2 used, no limit");
  expect(summaryRow("Memory").textContent).toBe("2.0 GiB used, no limit");
  expect(summaryRow("Disk").textContent).toBe("0 B used, no limit");
  expect(screen.queryByRole("meter", { name: "CPUs used" })).not.toBeInTheDocument();
});

test("a quota of zero shows what is used of it, not an empty meter", async () => {
  renderUsage(usage({ quota: { cpu: 0 }, used: { instances: 1, cpu: 1, memory: 0, disk: 0 } }));
  expect(await screen.findByText("1 used of 0")).toBeInTheDocument();
});

test("each cluster row shows usage of its limit, in bytes for memory and disk", async () => {
  renderUsage(
    usage({
      clusters: [
        {
          clusterId: "c-1",
          clusterName: "prod",
          project: "acme",
          status: "ready",
          usage: { instances: 1, cpu: 1, memory: GiB, disk: 0 },
          limits: { instances: 3, cpu: 4, memory: 6 * GiB },
        },
      ],
    }),
  );
  expect(await clusterRow("prod")).toEqual(["prod", "acme", "1 of 3", "1 of 4", "1.0 GiB of 6.0 GiB", "0 B"]);
});

test("a cluster that has not reported usage shows dashes", async () => {
  renderUsage(
    usage({
      clusters: [{ clusterId: "c-2", clusterName: "edge", project: "beta", status: "placing", usage: null, limits: null }],
    }),
  );
  expect(await clusterRow("edge")).toEqual(["edge", "beta", "—", "—", "—", "—"]);
});

test("the cluster name links to the cluster, and the project is monospace", async () => {
  renderUsage(
    usage({
      clusters: [{ clusterId: "c-1", clusterName: "prod", project: "acme", status: "ready", usage: { instances: 0, cpu: 0, memory: 0, disk: 0 }, limits: null }],
    }),
  );
  expect(await screen.findByRole("link", { name: "prod" })).toHaveAttribute("href", "/clusters/c-1");
  const project = screen.getByText("acme");
  expect(project.tagName).toBe("SPAN");
  expect(project).toHaveClass("mono-font");
});

test("no clusters shows the empty message and the table headers", async () => {
  renderUsage(usage({ clusters: [] }));
  expect(await screen.findByText("Not placed on any cluster yet.")).toBeInTheDocument();
  for (const h of ["Cluster", "Project", "Instances", "CPUs", "Memory", "Disk"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
  expect(screen.getByText("Each cluster may use what it already has plus whatever the tenant has left, so the total never exceeds the quota.")).toHaveClass("u-text--muted");
});
