import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { AppDeps } from "../app.ts";
import type { GatewayHandler } from "../front.ts";
import { resolvePrincipal, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import type { ClusterRow } from "../clusters/enroll.ts";
import type { ClusterCache } from "./clusters-cache.ts";
import { writeIncusError } from "./incus-error.ts";
import { relayRequest, relayUpgrade, type Upstreams } from "./relay.ts";
import { routeRequest, type Route } from "./route.ts";

/** One finished gateway request, for the request log. */
export interface GatewayRequest {
  cluster: ClusterRow;
  principal: Principal | null;
  method: string;
  path: string;
  status: number;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
  ip: string;
  upgrade: boolean;
}

export interface GatewayDeps extends AppDeps {
  clusterDomain: string;
  clusters: ClusterCache;
  upstreams: Upstreams;
  /** Serves `/clusters/<name>/ui/…` (Incendio); 404 when absent. */
  ui?: (req: IncomingMessage, res: ServerResponse, route: Route, cluster: ClusterRow, principal: Principal | null) => void;
  onRequest?: (r: GatewayRequest) => void;
}

const isAnonymousAllowed = (method: string, path: string) => method === "GET" && (path === "/1.0" || path.startsWith("/1.0?"));
const ipOf = (req: IncomingMessage) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

/** Builds the fetch-style Request resolvePrincipal reads (headers only). */
function authRequest(req: IncomingMessage, route: Route, publicUrl: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    // API clients use host routing with bearer tokens; cookies there are never credentials.
    if (k === "cookie" && route.mode === "host") continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  return new Request(`${publicUrl}${route.path}`, { method: req.method, headers });
}

/** The cluster API gateway (spec §3.3): route, authenticate, authorize, relay. */
export function createGateway(deps: GatewayDeps): GatewayHandler {
  const publicOrigin = new URL(deps.publicUrl).origin;

  /** Everything before relaying; returns what to relay with, or writes the refusal. */
  async function admit(req: IncomingMessage, out: ServerResponse | Duplex, upgrade: boolean) {
    const route = routeRequest({ host: req.headers.host, url: req.url }, deps.clusterDomain)!;
    const fail = (status: number, msg: string) => {
      writeIncusError(out, status, msg);
      return null;
    };
    const cluster = await deps.clusters.get(route.name);
    if (!cluster) return fail(404, `Unknown cluster "${route.name}"`);
    if (cluster.status === "disabled") return fail(503, `Cluster "${cluster.name}" is disabled`);

    let principal: Principal | null;
    try {
      principal = await resolvePrincipal(deps, authRequest(req, route, deps.publicUrl));
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.message);
      throw e;
    }
    const isUi = route.mode === "path" && !route.path.startsWith("/1.0");
    if (!principal && !isUi && !isAnonymousAllowed(req.method ?? "", route.path)) return fail(401, "Sign in to IncusCloud first (send an access token)");
    // Upgrades are GETs, so the session's Origin rule for changes must be applied here.
    const viaSession = principal && !req.headers.authorization;
    if (upgrade && viaSession && req.headers.origin && req.headers.origin !== publicOrigin) {
      return fail(403, "Cross-origin requests cannot use the session cookie");
    }
    if (principal && !(await deps.authz.check(`user:${principal.id}`, "can_access", `cluster:${cluster.id}`))) {
      return fail(403, `You have no access to cluster "${cluster.name}"`);
    }
    return { route, cluster, principal, isUi };
  }

  const report = (req: IncomingMessage, a: { cluster: ClusterRow; principal: Principal | null; route: Route }, started: number, upgrade: boolean) => (status: number, bytesIn: number, bytesOut: number) =>
    deps.onRequest?.({ cluster: a.cluster, principal: a.principal, method: req.method ?? "", path: a.route.path, status, bytesIn, bytesOut, durationMs: Math.round(performance.now() - started), ip: ipOf(req), upgrade });

  const target = (req: IncomingMessage, a: { cluster: ClusterRow; principal: Principal | null; route: Route }) => ({
    url: a.cluster.url,
    agent: deps.upstreams.agentFor(a.cluster),
    path: a.route.path,
    token: a.principal?.token,
    clientIp: ipOf(req),
  });

  return {
    match: (req) => routeRequest({ host: req.headers.host, url: req.url }, deps.clusterDomain) !== null,
    request(req, res) {
      const started = performance.now();
      admit(req, res, false)
        .then((a) => {
          if (!a) return;
          if (a.isUi) {
            if (deps.ui) return deps.ui(req, res, a.route, a.cluster, a.principal);
            return writeIncusError(res, 404, "Not found");
          }
          relayRequest(req, res, target(req, a), report(req, a, started, false));
        })
        .catch((e) => {
          log.error("gateway request failed", { error: String(e), url: req.url });
          writeIncusError(res, 500, "Internal error");
        });
    },
    upgrade(req, socket, head) {
      const started = performance.now();
      admit(req, socket, true)
        .then((a) => {
          if (!a) return;
          if (a.isUi) return writeIncusError(socket, 404, "Not found");
          relayUpgrade(req, socket, head, target(req, a), report(req, a, started, true));
        })
        .catch((e) => {
          log.error("gateway upgrade failed", { error: String(e), url: req.url });
          writeIncusError(socket, 500, "Internal error");
        });
    },
  };
}
