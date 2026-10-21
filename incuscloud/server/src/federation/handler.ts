import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import type { GatewayHandler } from "../front.ts";
import { resolvePrincipal, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { clusterMembers, placements, tenants } from "../db/schema.ts";
import type { ClusterRow } from "../clusters/enroll.ts";
import type { ClusterCache } from "../gateway/clusters-cache.ts";
import type { GatewayRequest } from "../gateway/handler.ts";
import { writeIncusError } from "../gateway/incus-error.ts";
import { relayUpgrade, type Upstreams } from "../gateway/relay.ts";
import { choose, type Candidate } from "../tenants/placement.ts";
import { fanInEvents } from "./events.ts";
import { type Answer, merge, standaloneView, untrustedServer, type Merged } from "./merge.ts";
import { qualifyResponse, stripBody, stripRequest, targetOf } from "./rewrite.ts";
import { type Call, fetchCluster, forward, isJson, readBody } from "./upstream.ts";

export interface FacadeDeps extends AppDeps {
  clusters: ClusterCache;
  /** Simplestreams servers Incendio's image picker lists, beyond its own default. */
  imageServers?: string[];
  upstreams: Upstreams;
  onRequest?: (r: GatewayRequest) => void;
}

const FACADE_PATH = /^\/1\.0(?:[/?]|$)/;
/** JSON request bodies are rewritten in memory up to this size. */
const BODY_LIMIT = 16 << 20;
/** Lists every page needs, whatever page asks: never scoped by the Referer. */
const SERVER_TTL_MS = 60_000;

type Obj = Record<string, unknown>;
interface Admitted {
  principal: Principal;
  /** The clusters the caller may reach, by name. */
  reachable: ClusterRow[];
  /** Every enrolled cluster's name (a qualifier naming one the caller cannot reach is a 403, not a merge). */
  known: string[];
}

const ipOf = (req: IncomingMessage) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
const sendJson = (res: ServerResponse, m: Merged) => {
  const body = Buffer.from(JSON.stringify(m.body));
  res.writeHead(m.status, { "content-type": "application/json", "content-length": String(body.length) });
  res.end(body);
};
const streamed = (req: IncomingMessage, path: string) => {
  const type = String(req.headers["content-type"] ?? "");
  return /octet-stream|multipart|x-tar|gzip/i.test(type) || /\/files(?:\?|$)/.test(path.split("?")[0]!);
};

/** `limits.memory` as bytes ("2GiB", "512MB"); 0 when absent or relative. */
function memoryOf(body: unknown): number {
  const v = String(((body as Obj)?.config as Obj | undefined)?.["limits.memory"] ?? "");
  const m = v.match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i?B?)?$/i);
  if (!m) return 0;
  const unit = (m[2] ?? "").toUpperCase();
  const pow = "KMGTP".indexOf(unit[0] ?? "") + 1;
  return Math.round(Number(m[1]) * (unit.includes("I") ? 1024 : 1000) ** pow);
}

/**
 * The federation facade (console plan): Incendio's API on the public
 * origin, with every reachable cluster as one. Requests that name a
 * cluster (qualified names, or the page they come from) go to it; reads
 * that name none fan out and merge. It relays with the caller's token,
 * like the gateway: it never widens anyone's access.
 */
export function createFacade(deps: FacadeDeps): GatewayHandler {
  const publicOrigin = new URL(deps.publicUrl).origin;
  const servers = new Map<string, { at: number; env: Obj; clustered: boolean }>();
  // What the federated /1.0 says as server config: the console's, never one cluster's.
  const extraImageServers = (deps.imageServers ?? []).filter((u) => u.replace(/\/$/, "") !== "https://images.linuxcontainers.org");
  const consoleConfig: Record<string, string> = extraImageServers.length
    ? { "user.ui.image_servers": JSON.stringify(extraImageServers.map((u) => ({ name: new URL(u).host, url: u }))) }
    : {};

  async function admit(req: IncomingMessage, out: ServerResponse | Duplex, upgrade: boolean): Promise<Admitted | null | "anonymous"> {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
    let principal: Principal | null;
    try {
      principal = await resolvePrincipal(deps, new Request(`${deps.publicUrl}${req.url ?? "/"}`, { method: req.method, headers }));
    } catch (e) {
      if (e instanceof ApiError) {
        writeIncusError(out, e.status, e.message);
        return null;
      }
      throw e;
    }
    if (!principal) return "anonymous";
    // Upgrades are GETs: the session's Origin rule for changes is applied here.
    if (upgrade && !req.headers.authorization && req.headers.origin && req.headers.origin !== publicOrigin) {
      writeIncusError(out, 403, "Cross-origin requests cannot use the session cookie");
      return null;
    }
    const all = (await deps.clusters.all()).filter((c) => c.status !== "disabled");
    const allowed = await Promise.all(all.map((c) => deps.authz.check(`user:${principal.id}`, "can_access", `cluster:${c.id}`)));
    return { principal, reachable: all.filter((_, i) => allowed[i]), known: all.map((c) => c.name) };
  }

  const call = (req: IncomingMessage, a: Admitted, cluster: ClusterRow, method: string, path: string): Call => ({ cluster, method, path, token: a.principal.token, clientIp: ipOf(req) });

  /**
   * The cluster's `/1.0` (cached): whether it is clustered, and its environment.
   * Only a trusted answer says so; an error or an untrusted one (the cluster
   * does not trust the caller yet) is not remembered, and the cluster is asked.
   */
  async function serverOf(req: IncomingMessage, a: Admitted, c: ClusterRow) {
    const hit = servers.get(c.id);
    if (hit && Date.now() - hit.at < SERVER_TTL_MS) return hit;
    const unknown = { at: 0, env: {} as Obj, clustered: true };
    try {
      const r = await fetchCluster(deps.upstreams, req, call(req, a, c, "GET", "/1.0"), { timeoutMs: 5000 });
      const meta = r.status === 200 ? (JSON.parse(r.body.toString()).metadata as Obj | undefined) : undefined;
      if (meta?.auth !== "trusted" || !meta.environment) return unknown;
      const env = meta.environment as Obj;
      const s = { at: Date.now(), env, clustered: !!env.server_clustered };
      servers.set(c.id, s);
      return s;
    } catch {
      return unknown;
    }
  }

  /** A synthesized answer for a standalone server's cluster views, or null to ask the cluster. */
  async function synthetic(req: IncomingMessage, a: Admitted, c: ClusterRow, method: string, path: string) {
    const s = await serverOf(req, a, c);
    if (s.clustered) return { standalone: false, view: null };
    const view = standaloneView(c, s.env, method, path, async () => {
      try {
        const r = await fetchCluster(deps.upstreams, req, call(req, a, c, "GET", "/1.0/resources"), { timeoutMs: 5000 });
        return JSON.parse(r.body.toString()).metadata as Obj;
      } catch {
        return null;
      }
    });
    return { standalone: true, view: view ? await view : null };
  }

  /**
   * Tenant projects on a cluster the caller may see (by permissions) but Incus
   * may not show them: a User holds no project relation there (spec decision 5).
   */
  async function seenProjects(a: Admitted, c: ClusterRow): Promise<Map<string, string>> {
    const rows = await deps.db
      .select({ project: placements.project, slug: tenants.slug })
      .from(placements)
      .innerJoin(tenants, eq(tenants.id, placements.tenantId))
      .where(and(eq(placements.clusterId, c.id), eq(placements.status, "ready")));
    const out = new Map<string, string>();
    for (const r of rows) if (await deps.acl.sees(a.principal, `/clusters/${c.name}/projects/${r.project}`)) out.set(r.project, r.slug);
    return out;
  }
  const projectObject = (name: string, slug: string) => ({ name, description: `IncusCloud tenant ${slug}`, config: {}, used_by: [] });
  const syncOf = (metadata: unknown) => ({ type: "sync", status: "Success", status_code: 200, operation: "", error_code: 0, error: "", metadata });

  /**
   * A project read Incus refuses, or a project list missing projects, answered
   * from what the caller may see: the project object, or the list with them.
   */
  async function withProjects(a: Admitted, c: ClusterRow, path: string, status: number, json: unknown): Promise<{ status: number; json: unknown }> {
    const [p, qs = ""] = path.split("?");
    const one = p!.match(/^\/1\.0\/projects\/([^/]+)$/);
    if (one && status === 403) {
      const name = decodeURIComponent(one[1]!);
      const slug = (await seenProjects(a, c)).get(name);
      return slug ? { status: 200, json: syncOf(projectObject(name, slug)) } : { status, json };
    }
    if (p === "/1.0/projects" && status === 200) {
      const list = ((json as { metadata?: unknown[] })?.metadata ?? []) as Array<string | { name: string }>;
      const has = new Set(list.map((x) => (typeof x === "string" ? decodeURIComponent(x.split("/").pop()!) : x.name)));
      const recursive = !!new URLSearchParams(qs).get("recursion") && new URLSearchParams(qs).get("recursion") !== "0";
      const extra = [...(await seenProjects(a, c))].filter(([name]) => !has.has(name));
      if (!extra.length) return { status, json };
      const more = extra.map(([name, slug]) => (recursive ? projectObject(name, slug) : `/1.0/projects/${encodeURIComponent(name)}`));
      return { status, json: { ...(json as object), metadata: [...list, ...more] } };
    }
    return { status, json };
  }

  /** One cluster: qualifiers off on the way in, on again on the way out. */
  async function one(req: IncomingMessage, res: ServerResponse, a: Admitted, c: ClusterRow, o: { path?: string; body?: Buffer | null } = {}) {
    const started = performance.now();
    const url = o.path ?? req.url ?? "/";
    const method = req.method ?? "GET";
    const { standalone, view } = await synthetic(req, a, c, method, stripRequest(url, c.name));
    const path = stripRequest(url, c.name, { standalone });
    const qualify = (json: unknown) => {
      const out = qualifyResponse(path, json, c.name, { standalone });
      // A standalone server's member and group views are synthesized as one member's cluster: it says so too.
      if (path === "/1.0") {
        const meta = (out as { metadata?: { environment?: Record<string, unknown>; config?: Record<string, unknown> } })?.metadata;
        if (standalone && meta?.environment) meta.environment.server_clustered = true;
        // The console's image servers, for Incendio's image picker on this cluster's pages too (unless it sets its own).
        if (meta && method === "GET") meta.config = { ...consoleConfig, ...meta.config };
      }
      return out;
    };
    if (view) return sendJson(res, { status: view.status, body: qualify(view.body) });
    if (method === "GET" && /^\/1\.0\/projects(?:\/[^/?]+)?(?:\?|$)/.test(path)) {
      // Read here, not relayed: a User's project is filled in when Incus refuses it.
      try {
        const r = await fetchCluster(deps.upstreams, req, call(req, a, c, method, path));
        const got = await withProjects(a, c, path, r.status, JSON.parse(r.body.toString("utf8")));
        deps.onRequest?.({ cluster: c, principal: a.principal, method, path, status: r.status, bytesIn: 0, bytesOut: r.body.length, durationMs: Math.round(performance.now() - started), ip: ipOf(req), upgrade: false });
        return sendJson(res, { status: got.status, body: qualify(got.json) });
      } catch {
        return writeIncusError(res, 502, `Cluster "${c.name}" did not answer`);
      }
    }
    let body: Buffer | null = o.body ?? null;
    if (body === null && method !== "GET" && method !== "HEAD" && !streamed(req, url)) {
      const raw = await readBody(req, BODY_LIMIT);
      if (!raw) return writeIncusError(res, 413, "Request body too large");
      body = raw;
    }
    if (body?.length && (isJson(req.headers) || !req.headers["content-type"] || /text\/plain/i.test(String(req.headers["content-type"])))) {
      try {
        body = Buffer.from(JSON.stringify(stripBody(JSON.parse(body.toString("utf8")), c.name)));
      } catch {}
    }
    forward(deps.upstreams, req, res, call(req, a, c, method, path), body, qualify, (status, bytesIn, bytesOut) =>
      deps.onRequest?.({ cluster: c, principal: a.principal, method, path, status, bytesIn, bytesOut, durationMs: Math.round(performance.now() - started), ip: ipOf(req), upgrade: false }),
    );
  }

  /** Every reachable cluster: the same read, answers merged. */
  async function fanOut(req: IncomingMessage, a: Admitted, url: string, clusters = a.reachable): Promise<Array<Answer | null>> {
    return Promise.all(
      clusters.map(async (c): Promise<Answer | null> => {
        const { standalone, view } = await synthetic(req, a, c, "GET", stripRequest(url, c.name));
        const path = stripRequest(url, c.name, { standalone });
        let status: number;
        let json: unknown;
        if (view) ({ status, body: json } = view);
        else {
          try {
            const r = await fetchCluster(deps.upstreams, req, call(req, a, c, "GET", path));
            ({ status, json } = await withProjects(a, c, path, r.status, JSON.parse(r.body.toString("utf8"))));
          } catch (e) {
            log.info("facade: cluster did not answer", { cluster: c.name, error: String(e) });
            return null;
          }
        }
        return { cluster: c.name, status, json: qualifyResponse(path, json, c.name, { standalone }) as Answer["json"] };
      }),
    );
  }

  /** `POST /1.0/instances` in a merged project: one of the clusters that has the project, by free memory. */
  async function place(req: IncomingMessage, res: ServerResponse, a: Admitted) {
    const url = req.url ?? "/";
    const project = new URL(url, "http://x").searchParams.get("project") ?? "default";
    const raw = await readBody(req, BODY_LIMIT);
    if (!raw) return writeIncusError(res, 413, "Request body too large");
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw.toString("utf8") || "{}");
    } catch {}
    // The project's clusters: those that show it (the project page's fill-in for Users included).
    const probes = await fanOut(req, a, `/1.0/projects/${encodeURIComponent(project)}`);
    const has = a.reachable.filter((_, i) => probes[i]?.status === 200);
    const mem = has.length
      ? await deps.db
          .select({
            clusterId: clusterMembers.clusterId,
            total: sql<number>`coalesce(sum(${clusterMembers.memoryTotal}) filter (where ${clusterMembers.status} = 'Online'), 0)`.mapWith(Number),
            used: sql<number>`coalesce(sum(${clusterMembers.memoryUsed}) filter (where ${clusterMembers.status} = 'Online'), 0)`.mapWith(Number),
          })
          .from(clusterMembers)
          .where(inArray(clusterMembers.clusterId, has.map((c) => c.id)))
          .groupBy(clusterMembers.clusterId)
      : [];
    const candidates: Candidate[] = has.map((c) => {
      const m = mem.find((x) => x.clusterId === c.id);
      return { clusterId: c.id, clusterName: c.name, project, placementStatus: "ready", clusterStatus: c.status, labels: c.labels, memoryTotal: m?.total ?? 0, memoryUsed: m?.used ?? 0 };
    });
    const where = choose(candidates, { memory: memoryOf(parsed) });
    if (!where.ok) return writeIncusError(res, has.length ? 409 : 404, has.length ? where.reason : `Project "${project}" is on none of your clusters`);
    const c = has.find((x) => x.id === where.pick.clusterId)!;
    return one(req, res, a, c, { body: raw });
  }

  /** The console's `X-IncusCloud-Scope`: "all", or a cluster name. */
  const scopeOf = (req: IncomingMessage) => {
    const v = req.headers["x-incuscloud-scope"];
    return typeof v === "string" && v ? v : undefined;
  };

  function sameOriginReferer(req: IncomingMessage): string | undefined {
    const r = req.headers.referer;
    if (!r) return undefined;
    try {
      return new URL(r).origin === publicOrigin ? r : undefined;
    } catch {
      return undefined;
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const a = await admit(req, res, false);
    if (!a) return;
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const path = url.split("?")[0]!;
    if (a === "anonymous") {
      if (method === "GET" && path === "/1.0") return sendJson(res, untrustedServer());
      return writeIncusError(res, 401, "Sign in to IncusCloud first");
    }
    // Every path, the always-merged ones included, is one cluster's when the request or the console page names one.
    const t = targetOf(url, sameOriginReferer(req), a.known, scopeOf(req));
    if (t.kind === "conflict") return writeIncusError(res, 400, `The request names several clusters (${t.clusters.join(", ")})`);
    if (t.kind === "one") {
      const c = a.reachable.find((x) => x.name === t.cluster);
      if (!c) return writeIncusError(res, 403, `You have no access to cluster "${t.cluster}"`);
      return one(req, res, a, c);
    }
    if (method === "GET" || method === "HEAD") {
      return sendJson(res, merge(path, await fanOut(req, a, url), { clusters: a.reachable.length, config: path === "/1.0" ? consoleConfig : undefined }));
    }
    if (method === "POST" && path === "/1.0/instances") return place(req, res, a);
    return writeIncusError(res, 400, "Choose a cluster: this change names none (open the project on one cluster, as name@cluster)");
  }

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const a = await admit(req, socket, true);
    if (!a) return;
    if (a === "anonymous") return writeIncusError(socket, 401, "Sign in to IncusCloud first");
    const url = req.url ?? "/";
    if (url.split("?")[0] === "/1.0/events") {
      const sources = await Promise.all(
        a.reachable.map(async (c) => {
          const { standalone } = await synthetic(req, a, c, "GET", "/1.0/none");
          return { cluster: c.name, url: c.url, agent: deps.upstreams.agentFor(c), path: stripRequest(url, c.name, { standalone }), token: a.principal.token, standalone };
        }),
      );
      return fanInEvents(req, socket, head, sources);
    }
    const t = targetOf(url, sameOriginReferer(req), a.known);
    if (t.kind !== "one") return writeIncusError(socket, 400, "Choose a cluster: this connection names none");
    const c = a.reachable.find((x) => x.name === t.cluster);
    if (!c) return writeIncusError(socket, 403, `You have no access to cluster "${t.cluster}"`);
    const { standalone } = await synthetic(req, a, c, "GET", "/1.0/none");
    relayUpgrade(req, socket, head, { url: c.url, agent: deps.upstreams.agentFor(c), path: stripRequest(url, c.name, { standalone }), token: a.principal.token, clientIp: ipOf(req) });
  }

  return {
    match: (req) => FACADE_PATH.test(req.url ?? ""),
    request(req, res) {
      handle(req, res).catch((e) => {
        log.error("facade request failed", { error: String(e), url: req.url });
        if (!res.headersSent) writeIncusError(res, 500, "Internal error");
        else res.destroy();
      });
    },
    upgrade(req, socket, head) {
      upgrade(req, socket, head).catch((e) => {
        log.error("facade upgrade failed", { error: String(e), url: req.url });
        writeIncusError(socket, 500, "Internal error");
      });
    },
  };
}
