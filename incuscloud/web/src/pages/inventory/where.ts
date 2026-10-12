import { clusterOf, nameOf } from "./tree";

/** Where an instance is created: a project on one cluster (`name@cluster`), from the facade's project list. */
const qualified = (projects: string[]) => projects.filter((p) => clusterOf(p));

export const clustersOf = (projects: string[]) => [...new Set(qualified(projects).map(clusterOf))].sort();

export const projectsOn = (projects: string[], cluster: string) =>
  qualified(projects)
    .filter((p) => clusterOf(p) === cluster)
    .map(nameOf)
    .sort();

/**
 * The project to create in: on the chosen cluster, the same project, else
 * default, else the first one there; with no cluster chosen, the first
 * cluster that has the project, else default anywhere, else anything.
 */
export function placeFor(projects: string[], want: { base: string; cluster?: string }): string | null {
  const all = qualified(projects).sort();
  const has = (p: string) => all.includes(p);
  if (want.cluster) {
    const here = projectsOn(projects, want.cluster);
    if (!here.length) return null;
    const pick = here.includes(want.base) ? want.base : here.includes("default") ? "default" : here[0]!;
    return `${pick}@${want.cluster}`;
  }
  for (const c of clustersOf(projects)) if (has(`${want.base}@${c}`)) return `${want.base}@${c}`;
  return all.find((p) => nameOf(p) === "default") ?? all[0] ?? null;
}
