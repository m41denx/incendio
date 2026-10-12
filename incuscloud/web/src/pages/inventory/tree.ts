import type { LxdClusterMember } from "@incendio/ui/types/cluster";
import type { LxdInstance } from "@incendio/ui/types/instance";

/**
 * The inventory (cluster → node → instance) over the federation facade,
 * where what belongs to one cluster is named `name@cluster`.
 */
export const clusterOf = (qualified: string) => {
  const at = qualified.lastIndexOf("@");
  return at < 0 ? "" : qualified.slice(at + 1);
};
export const nameOf = (qualified: string) => {
  const at = qualified.lastIndexOf("@");
  return at < 0 ? qualified : qualified.slice(0, at);
};

/** What the tree has selected: nothing (every cluster), a cluster, or one of its nodes. */
export interface Selection {
  cluster?: string;
  node?: string;
}

export function selectionOf(params: URLSearchParams): Selection {
  const node = params.get("node");
  if (node) return { cluster: clusterOf(node), node };
  const cluster = params.get("cluster");
  return cluster ? { cluster } : {};
}

export const inScope =
  (s: Selection) =>
  (i: Pick<LxdInstance, "location">): boolean =>
    s.node ? i.location === s.node : s.cluster ? clusterOf(i.location) === s.cluster : true;

export interface TreeNode {
  /** Qualified: `d1@cluster-d`. */
  name: string;
  label: string;
  status: string;
  instances: LxdInstance[];
}

export interface TreeCluster {
  name: string;
  nodes: TreeNode[];
  total: number;
  running: number;
}

/** Clusters by name, their nodes by name, each node's instances by name. */
export function buildTree(members: Array<Pick<LxdClusterMember, "server_name" | "status">>, instances: LxdInstance[], clusters: string[] = []): TreeCluster[] {
  const byCluster = new Map<string, Map<string, TreeNode>>();
  const nodesOf = (cluster: string) => {
    let m = byCluster.get(cluster);
    if (!m) byCluster.set(cluster, (m = new Map()));
    return m;
  };
  for (const c of clusters) nodesOf(c);
  for (const m of members) nodesOf(clusterOf(m.server_name)).set(m.server_name, { name: m.server_name, label: nameOf(m.server_name), status: m.status, instances: [] });
  for (const i of instances) {
    const nodes = nodesOf(clusterOf(i.location));
    let n = nodes.get(i.location);
    if (!n) nodes.set(i.location, (n = { name: i.location, label: nameOf(i.location), status: "Unknown", instances: [] }));
    n.instances.push(i);
  }
  const byName = <T>(key: (x: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));
  return [...byCluster]
    .map(([name, nodes]) => {
      const list = [...nodes.values()].sort(byName((n) => n.label));
      for (const n of list) n.instances.sort(byName((i) => i.name));
      const all = list.flatMap((n) => n.instances);
      return { name, nodes: list, total: all.length, running: all.filter((i) => i.status === "Running").length };
    })
    .sort(byName((c) => c.name));
}
