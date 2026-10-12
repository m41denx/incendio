import { clusterOf, nameOf } from "../pages/inventory/tree";
import { statusIcon } from "../pages/inventory/InventoryTree";
import { projectPath } from "./object";

/** What the sidebar's tree lists below each cluster. */
export type View = "instances" | "projects" | "nodes" | "networks" | "storage";
export const VIEWS: Array<{ view: View; label: string }> = [
  { view: "instances", label: "Instances" },
  { view: "projects", label: "Projects" },
  { view: "nodes", label: "Nodes" },
  { view: "networks", label: "Networks" },
  { view: "storage", label: "Storage" },
];

export interface TreeItem {
  key: string;
  label: string;
  icon: string;
  /** Where selecting it goes: the object's console URL. */
  to: string;
  count?: string;
  status?: string;
  children?: TreeItem[];
}

/** Every cluster's inventory, through the facade (names qualified `name@cluster`). */
export interface InventoryData {
  clusters: Array<{ name: string; status: string }>;
  members: Array<{ server_name: string; status: string }>;
  projects: Array<{ name: string }>;
  instances: Array<{ name: string; project: string; location: string; status: string }>;
  networks: Record<string, Array<{ name: string; managed: boolean }>>;
  pools: Array<{ name: string; status: string }>;
}

const enc = encodeURIComponent;
const byLabel = (a: TreeItem, b: TreeItem) => a.label.localeCompare(b.label);
const running = (list: InventoryData["instances"]) => list.filter((i) => i.status === "Running").length;

const instanceItem = (i: InventoryData["instances"][number]): TreeItem => ({
  key: `i:${i.project}/${i.name}`,
  label: i.name,
  icon: statusIcon(i.status),
  status: i.status,
  to: projectPath(i.project, `instance/${enc(i.name)}`),
});

const nodeItem = (name: string, status: string, instances?: InventoryData["instances"]): TreeItem => ({
  key: `n:${name}`,
  label: nameOf(name),
  icon: statusIcon(status),
  status,
  to: `/ui/cluster/member/${enc(name)}`,
  ...(instances ? { count: String(instances.length), children: instances.map(instanceItem).sort(byLabel) } : {}),
});

/** The tree for a view: "All clusters", every cluster, and what the view lists below each. */
export function buildView(view: View, d: InventoryData): TreeItem {
  const withInstances = view === "instances" || view === "projects";
  // A tenant member gets no cluster list: the clusters its members and projects are on.
  const names = new Set([
    ...d.clusters.map((c) => c.name),
    ...d.members.map((m) => clusterOf(m.server_name)),
    ...d.projects.map((p) => clusterOf(p.name)),
    ...(withInstances ? d.instances.map((i) => clusterOf(i.project)) : []),
  ]);
  names.delete("");
  const statusOf = new Map(d.clusters.map((c) => [c.name, c.status]));

  const clusters = [...names].map((cluster): TreeItem => {
    const instances = d.instances.filter((i) => clusterOf(i.project) === cluster);
    const members = d.members.filter((m) => clusterOf(m.server_name) === cluster);
    let children: TreeItem[] = [];
    if (view === "instances") {
      const nodes = new Map(members.map((m) => [m.server_name, m.status]));
      for (const i of instances) if (!nodes.has(i.location)) nodes.set(i.location, "Unknown");
      children = [...nodes].map(([name, status]) => nodeItem(name, status, instances.filter((i) => i.location === name)));
    } else if (view === "projects") {
      children = d.projects
        .filter((p) => clusterOf(p.name) === cluster)
        .map((p) => {
          const mine = instances.filter((i) => i.project === p.name);
          return { key: `p:${p.name}`, label: nameOf(p.name), icon: "folder", to: projectPath(p.name, "instances"), count: String(mine.length), children: mine.map(instanceItem).sort(byLabel) };
        });
    } else if (view === "nodes") {
      children = members.map((m) => nodeItem(m.server_name, m.status));
    } else if (view === "networks") {
      children = (d.networks[cluster] ?? [])
        .filter((n) => n.managed)
        .map((n) => ({ key: `net:${cluster}/${n.name}`, label: n.name, icon: "exposed", to: projectPath(`default@${cluster}`, `network/${enc(n.name)}`) }));
    } else {
      children = d.pools
        .filter((p) => clusterOf(p.name) === cluster)
        .map((p) => ({ key: `pool:${p.name}`, label: nameOf(p.name), icon: "storage-pool", status: p.status, to: projectPath(`default@${cluster}`, `storage/pool/${enc(p.name)}`) }));
    }
    return {
      key: `c:${cluster}`,
      label: cluster,
      icon: "cluster-host",
      status: statusOf.get(cluster),
      to: `/inventory/${enc(cluster)}`,
      ...(withInstances ? { count: `${running(instances)}/${instances.length}` } : {}),
      children: children.sort(byLabel),
    };
  });

  const all = withInstances ? d.instances.filter((i) => names.has(clusterOf(i.project))) : [];
  return {
    key: "root",
    label: "All clusters",
    icon: "cluster-host",
    to: "/",
    ...(withInstances ? { count: `${running(all)}/${all.length}` } : {}),
    children: clusters.sort(byLabel),
  };
}
