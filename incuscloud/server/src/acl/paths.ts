/** ACL paths: where an entry applies (spec "Objects and paths"). */
export type AclPath =
  | { kind: "root" }
  | { kind: "platform" }
  | { kind: "cluster"; cluster: string }
  | { kind: "group"; cluster: string; group: string }
  | { kind: "project"; cluster: string; project: string }
  | { kind: "instance"; cluster: string; project: string; instance: string }
  | { kind: "tenant"; tenant: string }
  | { kind: "kubernetes"; tenant: string; name: string };

/** Incus and IncusCloud names: no slashes, no spaces. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function parsePath(s: string): AclPath | null {
  if (s === "/") return { kind: "root" };
  if (s === "/platform") return { kind: "platform" };
  if (!s.startsWith("/")) return null;
  const parts = s.slice(1).split("/");
  if (parts.some((x, i) => i % 2 === 1 && !NAME.test(x))) return null;
  const [a, b, c, d, e, f] = parts;
  if (a === "clusters") {
    if (parts.length === 2) return { kind: "cluster", cluster: b! };
    if (parts.length === 4 && c === "groups") return { kind: "group", cluster: b!, group: d! };
    if (parts.length === 4 && c === "projects") return { kind: "project", cluster: b!, project: d! };
    if (parts.length === 6 && c === "projects" && e === "instances") return { kind: "instance", cluster: b!, project: d!, instance: f! };
  }
  if (a === "tenants") {
    if (parts.length === 2) return { kind: "tenant", tenant: b! };
    if (parts.length === 4 && c === "kubernetes") return { kind: "kubernetes", tenant: b!, name: d! };
  }
  return null;
}

export function formatPath(p: AclPath): string {
  switch (p.kind) {
    case "root":
      return "/";
    case "platform":
      return "/platform";
    case "cluster":
      return `/clusters/${p.cluster}`;
    case "group":
      return `/clusters/${p.cluster}/groups/${p.group}`;
    case "project":
      return `/clusters/${p.cluster}/projects/${p.project}`;
    case "instance":
      return `/clusters/${p.cluster}/projects/${p.project}/instances/${p.instance}`;
    case "tenant":
      return `/tenants/${p.tenant}`;
    case "kubernetes":
      return `/tenants/${p.tenant}/kubernetes/${p.name}`;
  }
}

/**
 * The paths whose entries can decide for `p`, most specific first. A
 * tenant's project sits under the tenant too: an entry on `/tenants/<t>`
 * applies to its project on every cluster, more specific than the cluster.
 */
export function chain(p: AclPath, tenantOf: (cluster: string, project: string) => string | undefined): string[] {
  switch (p.kind) {
    case "root":
      return ["/"];
    case "platform":
    case "tenant":
      return [formatPath(p), "/"];
    case "cluster":
      return [formatPath(p), "/"];
    case "group":
      return [formatPath(p), ...chain({ kind: "cluster", cluster: p.cluster }, tenantOf)];
    case "kubernetes":
      return [formatPath(p), ...chain({ kind: "tenant", tenant: p.tenant }, tenantOf)];
    case "project": {
      const t = tenantOf(p.cluster, p.project);
      return [formatPath(p), ...(t ? [`/tenants/${t}`] : []), ...chain({ kind: "cluster", cluster: p.cluster }, tenantOf)];
    }
    case "instance":
      return [formatPath(p), ...chain({ kind: "project", cluster: p.cluster, project: p.project }, tenantOf)];
  }
}
