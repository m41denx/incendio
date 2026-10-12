import { clusterOf, nameOf, selectionOf } from "./tree";
import { clustersOf } from "./where";

/**
 * The console's scope over Incendio's project pages: a project (each listed
 * once) and a cluster. The instance list may span every cluster; every other
 * section (profiles, networks, storage, images…) is one cluster's.
 */

/** The project selector lists merged projects by name, and the others where they are. */
export const listedProject = (names: string[]) => (name: string) => !clusterOf(name) || !names.includes(nameOf(name));

const route = (pathname: string) => {
  const m = pathname.match(/^\/ui\/project\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  let project = m[1]!;
  try {
    project = decodeURIComponent(project);
  } catch {
    // Not encoded: as it is.
  }
  return { project, rest: m[2] ?? "" };
};

/** Sections that span every cluster for a merged project. */
const spansClusters = (rest: string) => rest === "" || /^instances\/?$/.test(rest);

/** The clusters a project (by name) is on. */
const clustersWith = (names: string[], base: string) => clustersOf(names).filter((c) => names.includes(`${base}@${c}`));

const projectPath = (project: string, rest: string) => `/ui/project/${encodeURIComponent(project)}/${rest}`;

/** A detail page's list, for the same section on another cluster (where the item may not exist). */
const PLURAL: Record<string, string> = {
  instance: "instances",
  profile: "profiles",
  network: "networks",
  "network-acl": "network-acls",
  "network-zone": "network-zones",
  "network-address-set": "network-address-sets",
};
const STORAGE: Record<string, string> = { pool: "pools", pools: "pools", volume: "volumes", volumes: "volumes", bucket: "buckets", buckets: "buckets", "custom-isos": "custom-isos" };
function sectionOf(rest: string): string {
  const [first = "instances", second = ""] = rest.split("/");
  if (first === "storage") return `storage/${STORAGE[second] ?? "pools"}`;
  if (first === "member") return "instances";
  return PLURAL[first] ?? first;
}

/**
 * Where a per-cluster section of a merged (or unqualified) project goes: the
 * same section of the project on one cluster, `prefer` when it is there,
 * else the first. Null when the page needs no change.
 */
export function qualifyPath(pathname: string, names: string[], prefer?: string): string | null {
  const r = route(pathname);
  if (!r || clusterOf(r.project)) return null;
  const on = clustersWith(names, r.project);
  if (!on.length) return null;
  const cluster = prefer && on.includes(prefer) ? prefer : on[0]!;
  return projectPath(`${r.project}@${cluster}`, r.rest);
}

export interface ClusterChoice {
  label: string;
  value: string;
  to: string;
}

/** The Cluster select for this page: its choices and the current one; null outside projects. */
export function clusterChoices(pathname: string, search: string, names: string[]): { current: string; options: ClusterChoice[] } | null {
  const selected = selectionOf(new URLSearchParams(search)).cluster ?? "";
  const tree = (base: string, clusters: string[]) => ({
    current: selected,
    options: [{ label: "All clusters", value: "", to: base }, ...clusters.map((c) => ({ label: c, value: c, to: `${base}?cluster=${encodeURIComponent(c)}` }))],
  });
  if (/^\/ui\/all-projects\/instances\/?$/.test(pathname)) return tree("/ui/all-projects/instances", clustersOf(names));
  const r = route(pathname);
  if (!r) return null;
  const base = nameOf(r.project);
  const on = clustersWith(names, base);
  if (spansClusters(r.rest)) {
    // The instance list: every cluster at once, or one of them, as the inventory tree selects.
    if (names.includes(base) && on.length > 1) return { ...tree(projectPath(base, "instances"), on), current: clusterOf(r.project) || selected };
    return { current: clusterOf(r.project) || on[0] || "", options: on.map((c) => ({ label: c, value: c, to: projectPath(`${base}@${c}`, "instances") })) };
  }
  const section = sectionOf(r.rest);
  return { current: clusterOf(r.project), options: on.map((c) => ({ label: c, value: c, to: projectPath(`${base}@${c}`, section) })) };
}
