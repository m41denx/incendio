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
    { name: "web-d2", project: "default@cluster-d", location: "d2@cluster-d", status: "Running", type: "container" },
    { name: "web-d1", project: "default@cluster-d", location: "d1@cluster-d", status: "Stopped", type: "virtual-machine" },
    { name: "web-b", project: "kspike@cluster-b", location: "cluster-b@cluster-b", status: "Running", type: "container" },
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

test("instances view: every cluster, its members, their instances; counts running/total", () => {
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

test("members, networks and storage views", () => {
  expect(lines(buildView("members", data()))).toEqual([
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

/** Each row as kind/tone. */
const kinds = (t: TreeItem): string[] => [`${t.label}:${t.kind}/${t.tone}`, ...(t.children ?? []).flatMap(kinds)];

test("every row has its kind and a tone from its status", () => {
  expect(kinds(buildView("instances", data({ clusters: [...data().clusters, { name: "cluster-x", status: "error" }] })))).toEqual([
    "All clusters:root/none",
    "cluster-b:cluster/ok",
    "cluster-b:member/ok",
    "web-b:container/ok",
    "cluster-d:cluster/ok",
    "d1:member/ok",
    "web-d1:vm/off",
    "d2:member/ok",
    "web-d2:container/ok",
    "cluster-x:cluster/bad",
  ]);
  expect(kinds(buildView("networks", data())).slice(-1)).toEqual(["incusbr0:network/none"]);
  expect(kinds(buildView("storage", data())).slice(-1)).toEqual(["default:pool/ok"]);
});

test("the projects view lists a project's instances only: Kubernetes is a platform page", () => {
  const t = buildView("projects", data());
  const kspike = t.children!.find((c) => c.label === "cluster-b")!.children!.find((p) => p.label === "kspike")!;
  expect(kids(kspike)).toEqual(["web-b:container/ok"]);
});

const kids = (t: TreeItem) => (t.children ?? []).map((c) => `${c.label}:${c.kind}/${c.tone}`);

test("a tenant member's networks and pools open in their own project: they have no rights in default", () => {
  const tenant = data({ projects: [{ name: "kspike@cluster-b" }], networks: { "cluster-b": [{ name: "incusbr0", managed: true }] }, pools: [{ name: "default@cluster-b", status: "Created" }] });
  expect(lines(buildView("networks", tenant)).find((l) => l.includes("incusbr0"))).toBe("    incusbr0 -> /ui/project/kspike%40cluster-b/network/incusbr0");
  expect(lines(buildView("storage", tenant)).find((l) => l.includes("pool/"))).toBe("    default -> /ui/project/kspike%40cluster-b/storage/pool/default%40cluster-b");
});
