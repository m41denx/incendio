import { buildTree, clusterOf, inScope, nameOf, selectionOf } from "./tree";

const member = (server_name: string, status = "Online") => ({ server_name, status }) as never;
const inst = (name: string, location: string, status = "Running") => ({ name, location, status, project: `p@${clusterOf(location)}` }) as never;

test("qualified names split into name and cluster", () => {
  expect(clusterOf("d1@cluster-d")).toBe("cluster-d");
  expect(nameOf("d1@cluster-d")).toBe("d1");
  expect(clusterOf("plain")).toBe("");
  expect(nameOf("plain")).toBe("plain");
});

test("the selection comes from the URL: a node implies its cluster", () => {
  expect(selectionOf(new URLSearchParams("node=d1%40cluster-d"))).toEqual({ cluster: "cluster-d", node: "d1@cluster-d" });
  expect(selectionOf(new URLSearchParams("cluster=cluster-b"))).toEqual({ cluster: "cluster-b" });
  expect(selectionOf(new URLSearchParams(""))).toEqual({});
});

test("the scope keeps the selected node's or cluster's instances", () => {
  const all = [inst("a", "d1@cluster-d"), inst("b", "d2@cluster-d"), inst("c", "cluster-b@cluster-b")];
  expect(all.filter(inScope({})).map((i: { name: string }) => i.name)).toEqual(["a", "b", "c"]);
  expect(all.filter(inScope({ cluster: "cluster-d" })).map((i: { name: string }) => i.name)).toEqual(["a", "b"]);
  expect(all.filter(inScope({ cluster: "cluster-d", node: "d2@cluster-d" })).map((i: { name: string }) => i.name)).toEqual(["b"]);
});

test("the tree: clusters by name, their nodes, each node's instances with counts", () => {
  const tree = buildTree(
    [member("d2@cluster-d"), member("d1@cluster-d", "Offline"), member("cluster-b@cluster-b")],
    [inst("web", "d1@cluster-d"), inst("db", "d1@cluster-d", "Stopped"), inst("x", "cluster-b@cluster-b"), inst("lost", "d9@cluster-d")],
    ["cluster-c"],
  );
  expect(tree.map((c) => [c.name, c.total, c.running])).toEqual([
    ["cluster-b", 1, 1],
    ["cluster-c", 0, 0],
    ["cluster-d", 3, 2],
  ]);
  const d = tree[2]!;
  expect(d.nodes.map((n) => [n.name, n.label, n.status, n.instances.map((i) => i.name)])).toEqual([
    ["d1@cluster-d", "d1", "Offline", ["db", "web"]],
    ["d2@cluster-d", "d2", "Online", []],
    // An instance on a node the member list does not have (yet) still shows.
    ["d9@cluster-d", "d9", "Unknown", ["lost"]],
  ]);
});
