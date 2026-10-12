import { clusterOf, nameOf } from "../pages/inventory/tree";

/**
 * The console's selection: the object the URL shows, its one row of tabs
 * and the breadcrumb back up the inventory tree. The URL is the selection.
 */
export type Obj =
  | { kind: "root"; tab: RootTab }
  | { kind: "cluster"; cluster: string; tab: ClusterTab; sub?: string }
  | { kind: "member"; cluster: string; member: string }
  | { kind: "project"; cluster: string; project: string; tab: ProjectTab; sub?: string; detail?: string }
  | { kind: "instance"; cluster: string; project: string; name: string }
  | { kind: "network" | "pool" | "profile"; cluster: string; project: string; name: string }
  | { kind: "k8s"; cluster: string; project: string; name: string; tab: K8sTab }
  | { kind: "none" };

type RootTab = "summary" | "clusters" | "instances" | "kubernetes" | "warnings";
type ClusterTab = "summary" | "members" | "groups" | "projects" | "networks" | "storage" | "kubernetes" | "operations" | "access" | "configure";
type ProjectTab = "instances" | "profiles" | "networks" | "storage" | "images" | "kubernetes" | "usage" | "access" | "configure";
type K8sTab = "summary" | "nodes" | "activity" | "kubeconfig";
const K8S_TABS: Array<[K8sTab, string]> = [
  ["summary", "Summary"],
  ["nodes", "Nodes"],
  ["activity", "Activity"],
  ["kubeconfig", "Kubeconfig"],
];

/** A page in a tab's side menu: its key in the URL (a cluster's) or Incendio's path below the project (a project's). */
interface Sub {
  sub: string;
  label: string;
  /** A cluster's: the Incendio page it renders (`p` is the cluster's `default` project, encoded). A project's: the path below the project. */
  path: string;
  operator?: boolean;
}

const ROOT_TABS: Array<[RootTab, string, string]> = [
  ["summary", "Summary", "/"],
  ["clusters", "Clusters", "/all/clusters"],
  ["instances", "Instances", "/all/instances"],
  ["kubernetes", "Kubernetes", "/all/kubernetes"],
  ["warnings", "Warnings", "/all/warnings"],
];
const CLUSTER_TABS: Array<[ClusterTab, string]> = [
  ["summary", "Summary"],
  ["members", "Members"],
  ["groups", "Groups"],
  ["projects", "Projects"],
  ["networks", "Networks"],
  ["storage", "Storage"],
  ["kubernetes", "Kubernetes"],
  ["operations", "Operations"],
  ["access", "Access"],
  ["configure", "Configure"],
];
const NETWORK_SUBS = (p: string) => [
  { sub: "networks", label: "Networks", path: `/ui/project/${p}/networks` },
  { sub: "acls", label: "ACLs", path: `/ui/project/${p}/network-acls` },
  { sub: "address-sets", label: "Address sets", path: `/ui/project/${p}/network-address-sets` },
  { sub: "zones", label: "Zones", path: `/ui/project/${p}/network-zones` },
  { sub: "ipam", label: "IPAM", path: `/ui/project/${p}/network-ipam` },
];
const STORAGE_SUBS = (p: string) => [
  { sub: "pools", label: "Pools", path: `/ui/project/${p}/storage/pools` },
  { sub: "volumes", label: "Volumes", path: `/ui/project/${p}/storage/volumes` },
  { sub: "buckets", label: "Buckets", path: `/ui/project/${p}/storage/buckets` },
  { sub: "isos", label: "Custom ISOs", path: `/ui/project/${p}/storage/custom-isos` },
];
/** A cluster tab's side menu; `p` is the cluster's `default` project, encoded. */
export const CLUSTER_SUBS: Partial<Record<ClusterTab, (p: string) => Sub[]>> = {
  groups: () => [
    { sub: "cluster", label: "Cluster groups", path: "/ui/cluster/groups" },
    // The project comes from the page's picker.
    { sub: "placement", label: "Placement groups", path: "" },
  ],
  networks: (p) => [...NETWORK_SUBS(p), { sub: "integrations", label: "Integrations", path: "/ui/network-integrations" }],
  storage: STORAGE_SUBS,
  access: () => [
    // IncusCloud's own page.
    { sub: "who", label: "Who has access", path: "" },
    { sub: "identities", label: "Identities", path: "/ui/permissions/identities" },
    { sub: "groups", label: "Groups", path: "/ui/permissions/groups" },
    { sub: "idp-groups", label: "IdP groups", path: "/ui/permissions/idp-groups" },
    { sub: "grants", label: "Grants", path: "/ui/authorization/grants" },
    { sub: "check", label: "Check", path: "/ui/authorization/check" },
  ],
  configure: () => [
    { sub: "incuscloud", label: "IncusCloud", path: "", operator: true },
    { sub: "settings", label: "Server settings", path: "/ui/settings" },
    { sub: "cluster-settings", label: "Cluster settings", path: "/ui/cluster/settings" },
    { sub: "links", label: "Cluster links", path: "/ui/cluster/links" },
    { sub: "replicators", label: "Replicators", path: "/ui/cluster/replicators" },
    { sub: "certificates", label: "Certificates", path: "/ui/settings/certificates" },
    { sub: "logging", label: "Logging", path: "/ui/settings/logging" },
    { sub: "acme", label: "ACME", path: "/ui/settings/acme" },
    { sub: "warnings", label: "Warnings", path: "/ui/warnings" },
  ],
};

const strip = (subs: Sub[]) => subs.map((s) => ({ ...s, path: s.path.replace("/ui/project/P/", "") }));
const PROJECT_TABS: Array<[ProjectTab, string, string]> = [
  ["instances", "Instances", "instances"],
  ["profiles", "Profiles", "profiles"],
  ["networks", "Networks", "networks"],
  ["storage", "Storage", "storage/pools"],
  ["images", "Images", "local-images"],
  ["kubernetes", "Kubernetes", "kubernetes"],
  ["usage", "Usage", "usage"],
  ["access", "Access", "access/who"],
  ["configure", "Configure", "configuration"],
];
/** A project tab's side menu: Incendio's pages below the project. */
const PROJECT_SUBS: Partial<Record<ProjectTab, Sub[]>> = {
  networks: strip(NETWORK_SUBS("P")),
  storage: strip(STORAGE_SUBS("P")),
  access: [
    // IncusCloud's own page first: the order also decides which matches `access/who`.
    { sub: "who", label: "Who has access", path: "access/who" },
    { sub: "incus", label: "Incus access", path: "access" },
  ],
  configure: [
    { sub: "configuration", label: "Configuration", path: "configuration" },
    { sub: "placement", label: "Placement groups", path: "placement-groups" },
  ],
};

/** A project page's tab and side-menu page, by its path below the project. */
function projectSection(rest: string[]): { tab: ProjectTab; sub?: string; detail?: string } | null {
  const [first = "", second, third] = rest;
  for (const [tab, subs] of Object.entries(PROJECT_SUBS) as Array<[ProjectTab, Sub[]]>) {
    for (const s of subs) {
      const parts = s.path.split("/");
      if (parts.every((p, i) => rest[i] === p)) return { tab, sub: s.sub };
    }
  }
  // Detail pages with no tab row of their own: in their list's tab.
  const details: Record<string, [ProjectTab, string]> = { "network-acl": ["networks", "acls"], "network-zone": ["networks", "zones"], "network-address-set": ["networks", "address-sets"] };
  if (details[first] && second) return { tab: details[first][0], sub: details[first][1], detail: second };
  if (first === "storage") return { tab: "storage", sub: second === "pools" || !second ? "pools" : undefined };
  if (first === "configuration") return { tab: "configure", sub: "configuration" };
  void third;
  const plain: Record<string, ProjectTab> = { "": "instances", instances: "instances", profiles: "profiles", "local-images": "images", kubernetes: "kubernetes", usage: "usage" };
  return plain[first] ? { tab: plain[first] } : null;
}

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
    return { kind: "cluster", cluster: segs[1], tab, ...(CLUSTER_SUBS[tab] && segs[3] ? { sub: segs[3] } : {}) };
  }
  if (segs[0] === "ui" && segs[1] === "cluster" && segs[2] === "member" && segs[3]) {
    const cluster = clusterOf(segs[3]);
    return cluster ? { kind: "member", cluster, member: segs[3] } : { kind: "none" };
  }
  if (segs[0] === "ui" && segs[1] === "project" && segs[2]) {
    const project = segs[2];
    const cluster = clusterOf(project);
    if (!cluster) return { kind: "none" };
    const rest = segs.slice(3);
    const [first = "", second, third] = rest;
    const base = { cluster, project };
    if (first === "instance" && second) return { kind: "instance", ...base, name: second };
    if (first === "profile" && second) return { kind: "profile", ...base, name: second };
    if (first === "network" && second) return { kind: "network", ...base, name: second };
    // member/<m>/network/<n>
    if (first === "member" && third === "network" && segs[6]) return { kind: "network", ...base, name: segs[6] };
    if (first === "storage" && second === "pool" && third) return { kind: "pool", ...base, name: third };
    if (first === "kubernetes" && second) return { kind: "k8s", ...base, name: second, tab: K8S_TABS.find(([t]) => t === third)?.[0] ?? "summary" };
    const section = projectSection(rest);
    return section ? { kind: "project", ...base, ...section } : { kind: "none" };
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
  if (o.kind === "cluster")
    return CLUSTER_TABS.map(([t, label]) => ({ label, to: `/inventory/${enc(o.cluster)}${t === "summary" ? "" : `/${t}`}`, active: o.tab === t }));
  if (o.kind === "project") return PROJECT_TABS.map(([t, label, rest]) => ({ label, to: projectPath(o.project, rest), active: o.tab === t }));
  if (o.kind === "k8s") {
    const at = projectPath(o.project, `kubernetes/${enc(o.name)}`);
    return K8S_TABS.map(([t, label]) => ({ label, to: t === "summary" ? at : `${at}/${t}`, active: o.tab === t }));
  }
  return [];
}

/** The pages of a cluster tab's side menu, as the caller may see them. */
export const clusterSubs = (cluster: string, tab: ClusterTab, who: { operator: boolean }): Sub[] =>
  (CLUSTER_SUBS[tab]?.(enc(`default@${cluster}`)) ?? []).filter((s) => !s.operator || who.operator);

/** The selected tab's side menu (its pages), when it has several. */
export function subsOf(o: Obj, who: { operator: boolean }): Tab[] {
  if (o.kind === "cluster") {
    const subs = clusterSubs(o.cluster, o.tab, who);
    return subs.map((s) => ({ label: s.label, to: `/inventory/${enc(o.cluster)}/${o.tab}/${s.sub}`, active: o.sub === s.sub }));
  }
  if (o.kind === "project") return (PROJECT_SUBS[o.tab] ?? []).map((s) => ({ label: s.label, to: projectPath(o.project, s.path), active: o.sub === s.sub }));
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
  if (o.kind === "member") return [...crumbs, { label: nameOf(o.member), to: `/ui/cluster/member/${enc(o.member)}` }];
  crumbs.push({ label: nameOf(o.project), to: projectPath(o.project, "instances") });
  if (o.kind === "project") return o.detail ? [...crumbs, { label: o.detail, to: "" }] : crumbs;
  const at: Record<typeof o.kind, string> = {
    instance: `instance/${enc(o.name)}`,
    network: `network/${enc(o.name)}`,
    pool: `storage/pool/${enc(o.name)}`,
    k8s: `kubernetes/${enc(o.name)}`,
    profile: `profile/${enc(o.name)}`,
  };
  return [...crumbs, { label: o.kind === "pool" ? nameOf(o.name) : o.name, to: projectPath(o.project, at[o.kind]) }];
}

/** The cluster the selected object belongs to; "" for every cluster or none. */
export const clusterOfObj = (o: Obj) => (o.kind === "root" || o.kind === "none" ? "" : o.cluster);
