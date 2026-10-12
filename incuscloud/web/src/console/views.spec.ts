import { expect, test } from "vitest";
import { buildView, type InventoryData, type TreeItem } from "./views";

const data = (over: Partial<InventoryData> = {}): InventoryData => ({
  clusters: [
    { name: "cluster-d", status: "ready" },
    { name: "cluster-b", status: "ready" },
  ],
  members: [
    { server_name: "d2@cluster-d", status: "Online" },
    { server_name: "d1@cluster-d", status: "Online" },
    { server_name: "cluster-b@cluster-b", status: "Online" },
  ],
  projects: [{ name: "default@cluster-d" }, { name: "default@cluster-b" }, { name: "kspike@cluster-b" }],
  instances: [
    { name: "web-d2", project: "default@cluster-d", location: "d2@cluster-d", status: "Running" },
    { name: "web-d1", project: "default@cluster-d", location: "d1@cluster-d", status: "Stopped" },
    { name: "web-b", project: "kspike@cluster-b", location: "cluster-b@cluster-b", status: "Running" },
  ],
  networks: { "cluster-d": [{ name: "incusbr0", managed: true }, { name: "eth0", managed: false }] },
  pools: [{ name: "default@cluster-d", status: "Created" }],
  ...over,
});

/** The tree as indented lines: label, count, link. */
const lines = (t: TreeItem, depth = 0): string[] => [
  `${"  ".repeat(depth)}${t.label}${t.count !== undefined ? ` (${t.count})` : ""} -> ${t.to}`,
  ...(t.children ?? []).flatMap((c) => lines(c, depth + 1)),
];

test("instances view: every cluster, its nodes, their instances; counts running/total", () => {
  expect(lines(buildView("instances", data()))).toEqual([
    "All clusters (2/3) -> /",
    "  cluster-b (1/1) -> /inventory/cluster-b",
    "    cluster-b (1) -> /ui/cluster/member/cluster-b%40cluster-b",
    "      web-b -> /ui/project/kspike%40cluster-b/instance/web-b",
    "  cluster-d (1/2) -> /inventory/cluster-d",
    "    d1 (1) -> /ui/cluster/member/d1%40cluster-d",
    "      web-d1 -> /ui/project/default%40cluster-d/instance/web-d1",
    "    d2 (1) -> /ui/cluster/member/d2%40cluster-d",
    "      web-d2 -> /ui/project/default%40cluster-d/instance/web-d2",
  ]);
});

test("projects view: each cluster's projects and their instances", () => {
  expect(lines(buildView("projects", data()))).toEqual([
    "All clusters (2/3) -> /",
    "  cluster-b (1/1) -> /inventory/cluster-b",
    "    default (0) -> /ui/project/default%40cluster-b/instances",
    "    kspike (1) -> /ui/project/kspike%40cluster-b/instances",
    "      web-b -> /ui/project/kspike%40cluster-b/instance/web-b",
    "  cluster-d (1/2) -> /inventory/cluster-d",
    "    default (2) -> /ui/project/default%40cluster-d/instances",
    "      web-d1 -> /ui/project/default%40cluster-d/instance/web-d1",
    "      web-d2 -> /ui/project/default%40cluster-d/instance/web-d2",
  ]);
});

test("nodes, networks and storage views", () => {
  expect(lines(buildView("nodes", data()))).toEqual([
    "All clusters -> /",
    "  cluster-b -> /inventory/cluster-b",
    "    cluster-b -> /ui/cluster/member/cluster-b%40cluster-b",
    "  cluster-d -> /inventory/cluster-d",
    "    d1 -> /ui/cluster/member/d1%40cluster-d",
    "    d2 -> /ui/cluster/member/d2%40cluster-d",
  ]);
  // Managed networks only, in the cluster's default project.
  expect(lines(buildView("networks", data()))).toEqual([
    "All clusters -> /",
    "  cluster-b -> /inventory/cluster-b",
    "  cluster-d -> /inventory/cluster-d",
    "    incusbr0 -> /ui/project/default%40cluster-d/network/incusbr0",
  ]);
  expect(lines(buildView("storage", data()))).toEqual([
    "All clusters -> /",
    "  cluster-b -> /inventory/cluster-b",
    "  cluster-d -> /inventory/cluster-d",
    "    default -> /ui/project/default%40cluster-d/storage/pool/default%40cluster-d",
  ]);
});

test("an unreachable cluster stays in the tree with its status and nothing under it", () => {
  const t = buildView("instances", data({ clusters: [...data().clusters, { name: "cluster-x", status: "error" }] }));
  const x = t.children!.find((c) => c.label === "cluster-x")!;
  expect(x).toMatchObject({ status: "error", to: "/inventory/cluster-x" });
  expect(x.children ?? []).toEqual([]);
});

test("a tenant member (no cluster list) sees the clusters its members and projects are on", () => {
  const t = buildView("projects", data({ clusters: [], members: [{ server_name: "cluster-b@cluster-b", status: "Online" }], projects: [{ name: "kspike@cluster-b" }], instances: [] }));
  expect(lines(t)).toEqual(["All clusters (0/0) -> /", "  cluster-b (0/0) -> /inventory/cluster-b", "    kspike (0) -> /ui/project/kspike%40cluster-b/instances"]);
});
