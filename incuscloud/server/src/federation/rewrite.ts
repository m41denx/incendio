/**
 * The federation facade's naming: what belongs to one cluster is written
 * `<name>@<cluster>` (projects, members, storage pools, cluster groups,
 * operations, …). Requests lose the qualifiers before they reach their
 * cluster; JSON responses gain them on the way back.
 */

export const qualify = (name: string, cluster: string) => `${name}@${cluster}`;

/** Splits at the last `@`, only when what follows names a known cluster. */
export function split(s: string, clusters: Iterable<string>): { name: string; cluster?: string } {
  const at = s.lastIndexOf("@");
  if (at > 0) {
    const cluster = s.slice(at + 1);
    for (const c of clusters) if (c === cluster) return { name: s.slice(0, at), cluster };
  }
  return { name: s };
}

export type Target = { kind: "one"; cluster: string } | { kind: "all" } | { kind: "conflict"; clusters: string[] };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

function parse(pathAndQuery: string) {
  const q = pathAndQuery.indexOf("?");
  const path = q < 0 ? pathAndQuery : pathAndQuery.slice(0, q);
  const query = q < 0 ? "" : pathAndQuery.slice(q + 1);
  const params = query ? query.split("&").map((p) => {
    const eq = p.indexOf("=");
    return eq < 0 ? { k: decode(p), v: null as string | null, raw: p } : { k: decode(p.slice(0, eq)), v: decode(p.slice(eq + 1)), raw: p };
  }) : [];
  return { segs: path.split("/"), params };
}

/** The clusters a path names, through qualified segments, `project` or `target`. */
function clustersIn(pathAndQuery: string, clusters: string[]): string[] {
  const { segs, params } = parse(pathAndQuery);
  const found = new Set<string>();
  for (const s of segs) {
    const c = split(decode(s), clusters).cluster;
    if (c) found.add(c);
  }
  for (const p of params) {
    if ((p.k === "project" || p.k === "target") && p.v) {
      const c = split(p.v, clusters).cluster;
      if (c) found.add(c);
    }
  }
  return [...found];
}

/**
 * Which cluster a facade request is for: its own qualifiers first, then the
 * page it was made from (a global call on a project's page belongs to that
 * project's cluster), otherwise all of them.
 */
export function targetOf(pathAndQuery: string, referer: string | undefined, clusters: string[], scope?: string): Target {
  const own = clustersIn(pathAndQuery, clusters);
  if (own.length > 1) return { kind: "conflict", clusters: own };
  if (own.length === 1) return { kind: "one", cluster: own[0]! };
  // The console says which cluster its page is about (or that it wants every cluster).
  if (scope === "all") return { kind: "all" };
  if (scope && clusters.includes(scope)) return { kind: "one", cluster: scope };
  if (referer) {
    let path: string;
    try {
      path = new URL(referer, "http://x").pathname;
    } catch {
      path = "";
    }
    const seen = clustersIn(path, clusters);
    if (seen.length) return { kind: "one", cluster: seen[0]! };
    // A cluster's console page: /inventory/<cluster>/…
    const page = path.match(/^\/inventory\/([^/]+)/);
    if (page) {
      const name = decode(page[1]!);
      if (clusters.includes(name)) return { kind: "one", cluster: name };
    }
  }
  return { kind: "all" };
}

const stripName = (s: string, cluster: string) => (s.endsWith(`@${cluster}`) ? s.slice(0, -cluster.length - 1) : s);

/** The path and query to send to `cluster`: its qualifiers removed. */
export function stripRequest(pathAndQuery: string, cluster: string, o: { standalone?: boolean } = {}): string {
  const { segs, params } = parse(pathAndQuery);
  const path = segs
    .map((s) => {
      const d = decode(s);
      const n = stripName(d, cluster);
      return n === d ? s : encodeURIComponent(n);
    })
    .join("/");
  const kept: string[] = [];
  for (const p of params) {
    if (p.v === null) {
      kept.push(p.raw);
      continue;
    }
    const n = stripName(p.v, cluster);
    // A standalone server has one member, named after the cluster: it takes no target.
    if (p.k === "target" && o.standalone && n === cluster) continue;
    kept.push(n === p.v ? p.raw : `${encodeURIComponent(p.k)}=${encodeURIComponent(n)}`);
  }
  return kept.length ? `${path}?${kept.join("&")}` : path;
}

/** A request body for `cluster`: strings qualified with it lose the qualifier; URLs are stripped like paths. */
export function stripBody(v: unknown, cluster: string): unknown {
  if (typeof v === "string") return v.startsWith("/1.0/") ? stripRequest(v, cluster) : stripName(v, cluster);
  if (Array.isArray(v)) return v.map((x) => stripBody(x, cluster));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripBody(x, cluster)]));
  return v;
}

// URL entities that are global (no project), and where their name sits.
const GLOBAL_NAME_AT: Record<string, number> = {
  "storage-pools": 3,
  operations: 3,
  projects: 3,
  certificates: 3,
  warnings: 3,
  "network-integrations": 3,
};
const CLUSTER_NAME_AT: Record<string, number> = { members: 4, groups: 4 };

/** Whether a URL's entity lives in a project (and so carries `project`). */
function projectScoped(segs: string[]) {
  const kind = segs[2];
  if (!kind) return false;
  if (kind === "storage-pools") return segs.length > 4;
  return !(kind in GLOBAL_NAME_AT) && !["cluster", "events", "resources", "metrics", "auth"].includes(kind);
}

interface Ctx {
  cluster: string;
  standalone: boolean;
}

const q = (s: string, c: Ctx) => (s ? qualify(s, c.cluster) : s);
const member = (s: string, c: Ctx) => (c.standalone && (s === "none" || s === "") ? qualify(c.cluster, c.cluster) : q(s, c));

/** Qualifies one `/1.0/…` URL: global names, `project` (default when absent), `target`. */
function qualifyUrl(url: string, c: Ctx): string {
  const { segs, params } = parse(url);
  const kind = segs[2] ?? "";
  const at = kind === "cluster" ? CLUSTER_NAME_AT[segs[3] ?? ""] : GLOBAL_NAME_AT[kind];
  if (at !== undefined && segs[at]) segs[at] = q(decode(segs[at]), c);
  const out: string[] = [];
  let hasProject = false;
  for (const p of params) {
    if (p.v !== null && p.k === "project") {
      hasProject = true;
      out.push(`project=${q(p.v, c)}`);
    } else if (p.v !== null && p.k === "target") out.push(`target=${member(p.v, c)}`);
    else out.push(p.raw);
  }
  if (!hasProject && projectScoped(segs)) out.push(`project=${qualify("default", c.cluster)}`);
  const path = segs.join("/");
  return out.length ? `${path}?${out.join("&")}` : path;
}

type Json = unknown;

function walk(v: Json, c: Ctx, identity: Set<string>): Json {
  if (typeof v === "string") return v.startsWith("/1.0/") ? qualifyUrl(v, c) : v;
  if (Array.isArray(v)) return v.map((x) => walk(x, c, identity));
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, Json>;
  const isOperation = typeof o.id === "string" && "resources" in o;
  const out: Record<string, Json> = {};
  for (const [k, x] of Object.entries(o)) {
    if (typeof x === "string" && (k === "project" || k === "pool" || identity.has(k))) out[k] = q(x, c);
    else if (typeof x === "string" && k === "location") out[k] = member(x, c);
    else if (k === "id" && isOperation && typeof x === "string") out[k] = q(x, c);
    else if (Array.isArray(x) && (k === "locations" || (identity.has("server_name") && k === "groups") || (identity.has("members") && k === "members"))) {
      out[k] = x.map((m) => (typeof m === "string" ? (k === "groups" ? q(m, c) : member(m, c)) : m));
    } else if (k === "config" || k === "expanded_config") out[k] = x;
    else out[k] = walk(x, c, new Set());
  }
  return out;
}

/** Which identity fields name global things, from what was asked for. */
function identityOf(path: string): Set<string> {
  const segs = path.split("?")[0]!.split("/");
  const kind = segs[2];
  if (kind === "projects" || kind === "network-integrations" || (kind === "storage-pools" && segs.length <= 4)) return new Set(["name"]);
  if (kind === "certificates") return new Set(["fingerprint"]);
  if (kind === "warnings") return new Set(["uuid"]);
  if (kind === "cluster" && segs[3] === "members") return new Set(["server_name"]);
  if (kind === "cluster" && segs[3] === "groups") return new Set(["name", "members"]);
  return new Set();
}

/** A cluster's JSON response, with everything that belongs to it qualified. */
export function qualifyResponse(path: string, body: Json, cluster: string, o: { standalone?: boolean } = {}): Json {
  const c = { cluster, standalone: !!o.standalone };
  if (!body || typeof body !== "object" || Array.isArray(body)) return walk(body, c, new Set());
  // The envelope's own fields (an event's project and location) like any object's; its metadata by what was asked for.
  const { metadata, ...rest } = body as Record<string, Json>;
  const out = walk(rest, c, new Set()) as Record<string, Json>;
  if ("metadata" in (body as object)) out.metadata = walkMetadata(metadata, c, identityOf(path));
  return out;
}

// The response's own objects carry the identity fields; nested ones do not.
function walkMetadata(x: Json, c: Ctx, identity: Set<string>): Json {
  if (Array.isArray(x)) return x.map((m) => walk(m, c, identity));
  if (x && typeof x === "object") {
    const o = x as Record<string, Json>;
    // Operations lists: {running: [...], success: [...]}.
    if (!("id" in o) && Object.values(o).every(Array.isArray) && Object.keys(o).length) {
      return Object.fromEntries(Object.entries(o).map(([k, l]) => [k, walkMetadata(l, c, identity)]));
    }
  }
  return walk(x, c, identity);
}
