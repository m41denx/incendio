import { clusterOf } from "./tree";
import { clustersOf } from "./where";

/**
 * Old links to an unqualified project (`/ui/project/default/…`): the same
 * page of the project on one cluster. Projects are never merged.
 */
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

/** The clusters a project (by name) is on. */
const clustersWith = (names: string[], base: string) => clustersOf(names).filter((c) => names.includes(`${base}@${c}`));

const projectPath = (project: string, rest: string) => `/ui/project/${encodeURIComponent(project)}/${rest}`;

/**
 * Where a page of an unqualified project goes: the same page of the project
 * on one cluster, `prefer` when it is there, else the first. Null when the
 * page needs no change.
 */
export function qualifyPath(pathname: string, names: string[], prefer?: string): string | null {
  const r = route(pathname);
  if (!r || clusterOf(r.project)) return null;
  const on = clustersWith(names, r.project);
  if (!on.length) return null;
  const cluster = prefer && on.includes(prefer) ? prefer : on[0]!;
  return projectPath(`${r.project}@${cluster}`, r.rest);
}
