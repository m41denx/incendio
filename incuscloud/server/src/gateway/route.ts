/** Cluster names are DNS labels (they are also host names under IC_CLUSTER_DOMAIN). */
export const CLUSTER_NAME = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export interface Route {
  name: string;
  /** Path and query to send to the cluster (or, for /ui, to serve). */
  path: string;
  mode: "host" | "path";
}

// Only these belong to a cluster under /clusters/<name>/; the rest is the platform UI's.
const PATH_ROUTE = /^\/clusters\/([^/?#]+)(\/(?:1\.0|os\/1\.0|ui|documentation)(?:[/?].*)?)$/;

/** Which cluster a request is for, from its host (API clients) or path prefix (browsers); null if not the gateway's. */
export function routeRequest(req: { host?: string; url?: string }, clusterDomain: string): Route | null {
  const host = (req.host ?? "").toLowerCase().replace(/:\d+$/, "");
  const url = req.url ?? "/";
  const suffix = `.${clusterDomain.toLowerCase()}`;
  if (host.endsWith(suffix)) {
    const name = host.slice(0, -suffix.length);
    return CLUSTER_NAME.test(name) ? { name, path: url, mode: "host" } : null;
  }
  const m = url.match(PATH_ROUTE);
  if (!m || !CLUSTER_NAME.test(m[1]!)) return null;
  return { name: m[1]!, path: m[2]!, mode: "path" };
}
