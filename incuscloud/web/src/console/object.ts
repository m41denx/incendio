import { clusterOf, nameOf } from "../pages/inventory/tree";

/**
 * The console's selection: the object the URL shows, its one row of tabs
 * and the breadcrumb back up the inventory tree. The URL is the selection.
 */
export type Obj =
  | { kind: "root"; tab: RootTab }
  | { kind: "cluster"; cluster: string; tab: ClusterTab; sub?: string }
  | { kind: "node"; cluster: string; node: string }
  | { kind: "project"; cluster: string; project: string; tab: ProjectTab }
  | { kind: "instance"; cluster: string; project: string; name: string }
  | { kind: "network" | "pool" | "profile"; cluster: string; project: string; name: string }
  | { kind: "none" };

type RootTab = "summary" | "clusters" | "instances" | "warnings";
type ClusterTab = "summary" | "nodes" | "projects" | "networks" | "storage" | "operations" | "configure";
type ProjectTab = "instances" | "profiles" | "networks" | "storage" | "images" | "usage" | "configure";

const ROOT_TABS: Array<[RootTab, string, string]> = [
  ["summary", "Summary", "/"],
  ["clusters", "Clusters", "/all/clusters"],
  ["instances", "Instances", "/all/instances"],
  ["warnings", "Warnings", "/all/warnings"],
];
const CLUSTER_TABS: Array<[ClusterTab, string, string]> = [
  ["summary", "Summary", ""],
  ["nodes", "Nodes", "/nodes"],
  ["projects", "Projects", "/projects"],
  ["networks", "Networks", "/networks"],
  ["storage", "Storage", "/storage"],
  ["operations", "Operations", "/operations"],
  ["configure", "Configure", "/configure"],
];
const PROJECT_TABS: Array<[ProjectTab, string, string]> = [
  ["instances", "Instances", "instances"],
  ["profiles", "Profiles", "profiles"],
  ["networks", "Networks", "networks"],
  ["storage", "Storage", "storage/pools"],
  ["images", "Images", "local-images"],
  ["usage", "Usage", "usage"],
  ["configure", "Configure", "configuration"],
];

/** A project's list sections, by the first path segment after the project. */
const PROJECT_SECTIONS: Record<string, ProjectTab> = {
  "": "instances",
  instances: "instances",
  profiles: "profiles",
  networks: "networks",
  "network-acls": "networks",
  "network-zones": "networks",
  "network-ipam": "networks",
  "network-address-sets": "networks",
  storage: "storage",
  "local-images": "images",
  usage: "usage",
  configuration: "configure",
  access: "configure",
  "placement-groups": "configure",
  replicator: "configure",
};
/** Detail pages that are networking objects with their own page. */
const NETWORK_DETAILS = new Set(["network", "network-acl", "network-zone", "network-address-set"]);

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const enc = encodeURIComponent;

export const projectPath = (project: string, rest: string) => `/ui/project/${enc(project)}/${rest}`;

export function objectOf(pathname: string): Obj {
  const segs = pathname.split("/").filter(Boolean).map(safeDecode);
  if (!segs.length) return { kind: "root", tab: "summary" };
  if (segs[0] === "all") {
    const tab = ROOT_TABS.find(([t]) => t === segs[1] && t !== "summary");
    return tab ? { kind: "root", tab: tab[0] } : { kind: "none" };
  }
  if (segs[0] === "inventory" && segs[1]) {
    const tab = CLUSTER_TABS.find(([t]) => t === segs[2])?.[0] ?? "summary";
    return { kind: "cluster", cluster: segs[1], tab, ...(tab === "configure" && segs[3] ? { sub: segs[3] } : {}) };
  }
  if (segs[0] === "ui" && segs[1] === "cluster" && segs[2] === "member" && segs[3]) {
    const cluster = clusterOf(segs[3]);
    return cluster ? { kind: "node", cluster, node: segs[3] } : { kind: "none" };
  }
  if (segs[0] === "ui" && segs[1] === "project" && segs[2]) {
    const project = segs[2];
    const cluster = clusterOf(project);
    if (!cluster) return { kind: "none" };
    const [first = "", second, third] = segs.slice(3);
    const base = { cluster, project };
    if (first === "instance" && second) return { kind: "instance", ...base, name: second };
    if (first === "profile" && second) return { kind: "profile", ...base, name: second };
    if (NETWORK_DETAILS.has(first) && second) return { kind: "network", ...base, name: second };
    // member/<m>/network/<n>
    if (first === "member" && third === "network" && segs[6]) return { kind: "network", ...base, name: segs[6] };
    if (first === "storage" && second === "pool" && third) return { kind: "pool", ...base, name: third };
    const tab = PROJECT_SECTIONS[first];
    return tab ? { kind: "project", ...base, tab } : { kind: "none" };
  }
  return { kind: "none" };
}

export interface Tab {
  label: string;
  to: string;
  active: boolean;
}

/** The selected object's one row of tabs; none for objects whose page has its own. */
export function tabsOf(o: Obj, who: { operator: boolean }): Tab[] {
  if (o.kind === "root")
    return ROOT_TABS.filter(([t]) => t !== "clusters" || who.operator).map(([t, label, to]) => ({ label, to, active: o.tab === t }));
  if (o.kind === "cluster") return CLUSTER_TABS.map(([t, label, to]) => ({ label, to: `/inventory/${enc(o.cluster)}${to}`, active: o.tab === t }));
  if (o.kind === "project") return PROJECT_TABS.map(([t, label, rest]) => ({ label, to: projectPath(o.project, rest), active: o.tab === t }));
  return [];
}

export interface Crumb {
  label: string;
  to: string;
}

export function crumbsOf(o: Obj): Crumb[] {
  if (o.kind === "none") return [];
  const crumbs: Crumb[] = [{ label: "All clusters", to: "/" }];
  if (o.kind === "root") return crumbs;
  crumbs.push({ label: o.cluster, to: `/inventory/${enc(o.cluster)}` });
  if (o.kind === "cluster") return crumbs;
  if (o.kind === "node") return [...crumbs, { label: nameOf(o.node), to: `/ui/cluster/member/${enc(o.node)}` }];
  crumbs.push({ label: nameOf(o.project), to: projectPath(o.project, "instances") });
  if (o.kind === "project") return crumbs;
  const at: Record<typeof o.kind, string> = {
    instance: `instance/${enc(o.name)}`,
    network: `network/${enc(o.name)}`,
    pool: `storage/pool/${enc(o.name)}`,
    profile: `profile/${enc(o.name)}`,
  };
  return [...crumbs, { label: o.kind === "pool" ? nameOf(o.name) : o.name, to: projectPath(o.project, at[o.kind]) }];
}

/** The cluster the selected object belongs to; "" for every cluster or none. */
export const clusterOfObj = (o: Obj) => (o.kind === "root" || o.kind === "none" ? "" : o.cluster);
