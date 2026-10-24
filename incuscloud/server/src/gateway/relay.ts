import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { PinnedAgent } from "@incendio/api/node";
import { writeIncusError } from "./incus-error.ts";

/** Where and as whom to forward one request. */
export interface RelayTarget {
  /** The cluster's base URL, `https://host:port`. */
  url: string;
  agent: PinnedAgent;
  /** Path and query on the cluster. */
  path: string;
  /** The caller's access token; absent for anonymous `GET /1.0`. */
  token?: string;
  clientIp: string;
}

/** One keep-alive agent per cluster and certificate. It never presents a client certificate (spec D1). */
export class Upstreams {
  private agents = new Map<string, PinnedAgent>();
  agentFor(cluster: { id: string; fingerprint: string }): PinnedAgent {
    const key = `${cluster.id}/${cluster.fingerprint}`;
    let a = this.agents.get(key);
    if (!a) {
      a = new PinnedAgent({ pin: cluster.fingerprint });
      this.agents.set(key, a);
    }
    return a;
  }
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate", "proxy-connection"]);
// Ours, or the caller's to us (Origin is checked by the gateway; Incus would
// reject one that does not match the Host we send): never forwarded.
const PRIVATE = (k: string) => k === "host" || k === "cookie" || k === "authorization" || k === "origin" || k.startsWith("x-ic-") || k.startsWith("x-forwarded-") || k === "forwarded";

export function upstreamHeaders(req: IncomingMessage, t: RelayTarget, upgrade: boolean) {
  const h: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || PRIVATE(k)) continue;
    if (HOP.has(k) && !(upgrade && (k === "upgrade" || k === "connection"))) continue;
    h[k] = v;
  }
  h.host = new URL(t.url).host;
  h["x-forwarded-for"] = t.clientIp;
  h["x-forwarded-proto"] = "https";
  if (t.token) h.authorization = `Bearer ${t.token}`;
  return h;
}

export const ipOf = (req: IncomingMessage) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

/**
 * A cluster's response headers as relayed from the platform's origin. Callers' cookies never reach
 * the cluster, so its own are of no use, and they would land on the platform's origin; a body (a
 * file read from an instance, say) never runs as a page there. Incus's documentation is its own
 * static site and is left as it is.
 */
export function downstreamHeaders(headers: IncomingHttpHeaders, path: string) {
  const h: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && !HOP.has(k) && k !== "set-cookie") h[k] = v;
  h["x-content-type-options"] = "nosniff";
  if (!/^\/documentation(?:[/?]|$)/.test(path)) h["content-security-policy"] = "sandbox";
  return h;
}

export const describe = (e: Error) => (/does not match the pinned/.test(e.message) ? `The cluster presented an unexpected certificate (${e.message})` : `Cluster unreachable: ${e.message}`);

function upstreamRequest(req: IncomingMessage, t: RelayTarget, upgrade: boolean) {
  const u = new URL(t.url);
  return httpsRequest({ protocol: "https:", hostname: u.hostname, port: u.port, path: t.path, method: req.method, headers: upstreamHeaders(req, t, upgrade), agent: t.agent });
}

/** Forwards a request, streaming both bodies; upstream failures become Incus-shaped 502s. */
export function relayRequest(req: IncomingMessage, res: ServerResponse, t: RelayTarget, onDone?: (status: number, bytesIn: number, bytesOut: number) => void) {
  let bytesIn = 0;
  let bytesOut = 0;
  let status = 502;
  const up = upstreamRequest(req, t, false);
  up.on("response", (ures) => {
    status = ures.statusCode ?? 502;
    res.writeHead(status, downstreamHeaders(ures.headers, t.path));
    ures.on("data", (d: Buffer) => (bytesOut += d.length));
    ures.pipe(res);
  });
  up.on("error", (e) => {
    if (res.headersSent) res.destroy();
    else writeIncusError(res, 502, describe(e));
  });
  req.on("data", (d: Buffer) => (bytesIn += d.length));
  // The caller left: stop the cluster side too.
  res.on("close", () => {
    if (!res.writableFinished) up.destroy();
    onDone?.(status, bytesIn, bytesOut);
  });
  req.pipe(up);
}

/** Relays an upgrade (websocket, `Upgrade: sftp`) as raw bytes once the cluster answers 101. */
export function relayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, t: RelayTarget, onDone?: (status: number, bytesIn: number, bytesOut: number) => void) {
  let bytesIn = 0;
  let bytesOut = 0;
  let status = 502;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone?.(status, bytesIn, bytesOut);
  };
  const up = upstreamRequest(req, t, true);
  up.on("upgrade", (ures, usocket: Duplex, uhead: Buffer) => {
    status = 101;
    let head101 = `HTTP/1.1 ${ures.statusCode} ${ures.statusMessage}\r\n`;
    for (let i = 0; i < ures.rawHeaders.length; i += 2) head101 += `${ures.rawHeaders[i]}: ${ures.rawHeaders[i + 1]}\r\n`;
    socket.write(`${head101}\r\n`);
    if (uhead.length) socket.write(uhead);
    if (head.length) usocket.write(head);
    socket.on("data", (d: Buffer) => (bytesIn += d.length));
    usocket.on("data", (d: Buffer) => (bytesOut += d.length));
    usocket.pipe(socket).pipe(usocket);
    const end = () => {
      socket.destroy();
      usocket.destroy();
      finish();
    };
    for (const s of [socket, usocket]) {
      s.on("error", end);
      s.on("close", end);
    }
  });
  up.on("response", (ures) => {
    // The cluster refused the upgrade: relay its answer as a normal response.
    status = ures.statusCode ?? 502;
    let raw = `HTTP/1.1 ${ures.statusCode} ${ures.statusMessage}\r\n`;
    for (let i = 0; i < ures.rawHeaders.length; i += 2) if (!/^(transfer-encoding|connection|set-cookie)$/i.test(ures.rawHeaders[i]!)) raw += `${ures.rawHeaders[i]}: ${ures.rawHeaders[i + 1]}\r\n`;
    socket.write(`${raw}connection: close\r\n\r\n`);
    ures.pipe(socket);
    ures.on("end", finish);
  });
  up.on("error", (e) => {
    writeIncusError(socket, 502, describe(e));
    finish();
  });
  socket.on("error", () => up.destroy());
  up.end();
}
