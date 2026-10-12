import type { ClusterRow } from "../clusters/enroll.ts";

/** One cluster's answer to a fanned-out read, already qualified. */
export interface Answer {
  cluster: string;
  status: number;
  json: { type?: string; metadata?: unknown; error?: string; error_code?: number } | null;
}

export interface Merged {
  status: number;
  body: unknown;
}

type Obj = Record<string, unknown>;
const sync = (metadata: unknown): Merged => ({ status: 200, body: { type: "sync", status: "Success", status_code: 200, operation: "", error_code: 0, error: "", metadata } });
const error = (status: number, msg: string): Merged => ({ status, body: { type: "error", error: msg, error_code: status } });
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** What an anonymous caller learns: an Incus server it is not signed in to. */
export const untrustedServer = () => sync({ api_extensions: [], api_status: "stable", api_version: "1.0", auth: "untrusted", public: false, auth_methods: ["oidc"] });

/** Sums projects' `state.resources` usage; a limit is unlimited (-1) when any is. */
function sumState(states: Obj[]): Obj {
  const resources: Record<string, { limit: number; usage: number }> = {};
  for (const s of states) {
    for (const [k, v] of Object.entries((s.resources ?? {}) as Record<string, { limit: number; usage: number }>)) {
      const cur = resources[k];
      if (!cur) resources[k] = { ...v };
      else {
        cur.usage += v.usage;
        cur.limit = cur.limit < 0 || v.limit < 0 ? -1 : cur.limit + v.limit;
      }
    }
  }
  return { ...states[0], resources };
}

/** The server as one federated, clustered Incus: what every cluster supports, no one cluster's config. */
function federatedServer(servers: Obj[]): Obj {
  const ext = servers.map((s) => new Set((s.api_extensions ?? []) as string[]));
  const first = servers[0]!;
  const api_extensions = [...ext[0]!].filter((e) => ext.every((x) => x.has(e)));
  const env = isObj(first.environment) ? first.environment : {};
  return { ...first, api_extensions, auth: servers.some((s) => s.auth === "trusted") ? "trusted" : first.auth, config: {}, environment: { ...env, server_clustered: true, server_name: "incuscloud" } };
}

/**
 * Merges fanned-out reads: lists concatenate (operation lists by status),
 * single objects come from the first cluster that has them. Federated
 * views: `/1.0`, projects (with a merged entry per name on several
 * clusters), project state (summed) and `/1.0/cluster`.
 */
export function merge(path: string, answers: Array<Answer | null>, o: { clusters: number; config?: Record<string, string> }): Merged {
  const segs = path.split("/");
  const ok = answers.filter((a): a is Answer => !!a && a.status === 200 && a.json?.type === "sync");
  const metas = ok.map((a) => a.json!.metadata);

  if (path === "/1.0") {
    const server = ok.length ? federatedServer(metas as Obj[]) : { api_extensions: [], api_status: "stable", api_version: "1.0", auth: "trusted", public: false, environment: { server_clustered: true, server_name: "incuscloud" } };
    return sync({ ...server, config: o.config ?? {} });
  }
  if (path === "/1.0/cluster") return sync({ server_name: "", enabled: true, member_config: [] });

  if (!ok.length) {
    const failed = answers.filter((a): a is Answer => !!a && !!a.json && a.status >= 400);
    if (!o.clusters || !failed.length) {
      if (!o.clusters && segs.length % 2 === 1) return sync(path === "/1.0/operations" ? {} : []);
      if (!failed.length) return error(o.clusters ? 503 : 404, o.clusters ? "No cluster answered" : "Not found");
    }
    const real = failed.find((a) => a.status !== 404) ?? failed[0]!;
    return { status: real.status, body: real.json };
  }

  if (path === "/1.0/projects") {
    const list = metas.flat() as unknown[];
    // Never merged: a shared name means nothing across clusters.
    return sync(list);
  }
  const project = path.match(/^\/1\.0\/projects\/([^/]+)(\/state)?$/);
  if (project) {
    if (project[2]) return sync(sumState(metas as Obj[]));
    return sync(mergedProject(decodeURIComponent(project[1]!), metas as Obj[]));
  }

  if (metas.every(Array.isArray)) return sync(metas.flat());
  // Operation lists: {running: [...], success: [...]}.
  if (metas.every((m) => isObj(m) && Object.values(m).every(Array.isArray))) {
    const out: Record<string, unknown[]> = {};
    for (const m of metas as Array<Record<string, unknown[]>>) for (const [k, l] of Object.entries(m)) out[k] = [...(out[k] ?? []), ...l];
    return sync(out);
  }
  return { status: 200, body: ok[0]!.json };
}

/** A project name on several clusters, as one project: the first's settings, everyone's users. */
function mergedProject(name: string, same: Obj[]): Obj {
  return { ...same[0], name, description: `${name} on ${same.length} clusters`, used_by: same.flatMap((p) => (p.used_by ?? []) as unknown[]) };
}

/** A standalone server's cluster views: it is one member, named after its cluster. */
export function standaloneView(cluster: ClusterRow, env: Obj, method: string, path: string, resources: () => Promise<Obj | null>): Promise<Merged | null> | null {
  if (method !== "GET") return null;
  const [p, qs = ""] = path.split("?");
  const recursion = new URLSearchParams(qs).get("recursion");
  const recursive = !!recursion && recursion !== "0";
  const name = cluster.name;
  const member = { server_name: name, url: cluster.url, database: false, status: "Online", message: "Fully operational", architecture: env.kernel_architecture ?? "", failure_domain: "default", description: "", config: {}, groups: ["default"], roles: [] };
  const group = { name: "default", description: "", members: [name] };
  const m = p!.match(/^\/1\.0\/cluster(?:\/(members|groups)(?:\/([^/]+)(\/state)?)?)?$/);
  if (!m) return null;
  const [, kind, item, state] = m;
  if (!kind) return Promise.resolve(sync({ server_name: name, enabled: true, member_config: [] }));
  if (kind === "groups") {
    if (!item) return Promise.resolve(sync(recursive ? [group] : ["/1.0/cluster/groups/default"]));
    return Promise.resolve(decodeURIComponent(item) === "default" ? sync(group) : error(404, "Cluster group not found"));
  }
  if (!item) return Promise.resolve(sync(recursive ? [member] : [`/1.0/cluster/members/${name}`]));
  if (decodeURIComponent(item) !== name) return Promise.resolve(error(404, "Cluster member not found"));
  if (!state) return Promise.resolve(sync(member));
  return resources().then((r) => {
    const mem = (r?.memory ?? {}) as { total?: number; used?: number };
    return sync({
      sysinfo: { uptime: 0, load_averages: [0, 0, 0], total_ram: mem.total ?? 0, free_ram: (mem.total ?? 0) - (mem.used ?? 0), shared_ram: 0, buffered_ram: 0, total_swap: 0, free_swap: 0, processes: 0, logical_cpus: (r?.cpu as Obj | undefined)?.total ?? 0 },
      storage_pools: {},
    });
  });
}
