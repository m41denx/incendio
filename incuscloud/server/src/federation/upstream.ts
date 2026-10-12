import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ClusterRow } from "../clusters/enroll.ts";
import { writeIncusError } from "../gateway/incus-error.ts";
import { describe, upstreamHeaders, type Upstreams } from "../gateway/relay.ts";

/** One cluster call's parameters: the caller's request supplies the headers. */
export interface Call {
  cluster: ClusterRow;
  method: string;
  /** Path and query on the cluster (already stripped of qualifiers). */
  path: string;
  token: string;
  clientIp: string;
}

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate", "proxy-connection"]);

function open(upstreams: Upstreams, req: IncomingMessage, c: Call, body: Buffer | null) {
  const headers = upstreamHeaders(req, { url: c.cluster.url, agent: upstreams.agentFor(c.cluster), path: c.path, token: c.token, clientIp: c.clientIp }, false);
  // Responses are rewritten: they must come back plain.
  delete headers["accept-encoding"];
  if (body) {
    headers["content-length"] = String(body.length);
    delete headers["transfer-encoding"];
  }
  const u = new URL(c.cluster.url);
  return httpsRequest({ protocol: "https:", hostname: u.hostname, port: u.port, path: c.path, method: c.method, headers, agent: upstreams.agentFor(c.cluster) });
}

/** A buffered call (fan-out reads, probes); rejects on network failure or timeout. */
export function fetchCluster(upstreams: Upstreams, req: IncomingMessage, c: Call, o: { body?: Buffer; timeoutMs?: number } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const up = open(upstreams, req, c, o.body ?? Buffer.alloc(0));
    up.setTimeout(o.timeoutMs ?? 15_000, () => up.destroy(new Error("timed out")));
    up.on("response", (r) => {
      const chunks: Buffer[] = [];
      r.on("data", (d: Buffer) => chunks.push(d));
      r.on("end", () => resolve({ status: r.statusCode ?? 502, headers: r.headers, body: Buffer.concat(chunks) }));
      r.on("error", reject);
    });
    up.on("error", reject);
    up.end(o.body);
  });
}

export const isJson = (h: IncomingHttpHeaders) => /\bjson\b/i.test(String(h["content-type"] ?? ""));

/**
 * Relays one request to one cluster. JSON responses are rewritten by
 * `rewrite`; everything else streams through. `body` is the rewritten
 * request body, or null to stream the caller's.
 */
export function forward(
  upstreams: Upstreams,
  req: IncomingMessage,
  res: ServerResponse,
  c: Call,
  body: Buffer | null,
  rewrite: (json: unknown) => unknown,
  onDone?: (status: number, bytesIn: number, bytesOut: number) => void,
) {
  let status = 502;
  let bytesOut = 0;
  const up = open(upstreams, req, c, body);
  up.on("response", (ur) => {
    status = ur.statusCode ?? 502;
    const h: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(ur.headers)) if (v !== undefined && !HOP.has(k)) h[k] = v;
    if (!isJson(ur.headers)) {
      res.writeHead(status, h);
      ur.on("data", (d: Buffer) => (bytesOut += d.length));
      ur.pipe(res);
      return;
    }
    const chunks: Buffer[] = [];
    ur.on("data", (d: Buffer) => chunks.push(d));
    ur.on("end", () => {
      const raw = Buffer.concat(chunks);
      let out = raw;
      try {
        out = Buffer.from(JSON.stringify(rewrite(JSON.parse(raw.toString("utf8")))));
      } catch {}
      h["content-length"] = String(out.length);
      bytesOut = out.length;
      res.writeHead(status, h);
      res.end(out);
    });
  });
  up.on("error", (e) => {
    if (res.headersSent) res.destroy();
    else writeIncusError(res, 502, describe(e));
  });
  res.on("close", () => {
    if (!res.writableFinished) up.destroy();
    onDone?.(status, body?.length ?? 0, bytesOut);
  });
  if (body) up.end(body);
  else req.pipe(up);
}

/** Reads a request body up to `limit` bytes; null when it is larger. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let over = false;
    req.on("data", (d: Buffer) => {
      n += d.length;
      if (n > limit) over = true;
      else chunks.push(d);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
