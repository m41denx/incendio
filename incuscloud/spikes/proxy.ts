// Spike B: authenticating reverse proxy in front of Incus.
// Host routing <cluster>.<CLUSTER_DOMAIN> (stock Incus clients drop path
// prefixes) and path routing /clusters/<cluster>/... (browser UI).
// Caller's bearer token only, no client certificate, bodies streamed,
// upgrades (websocket AND `Upgrade: sftp`) relayed as raw byte streams.
//
// Built on node:https rather than Bun.serve: Bun.serve cannot hand over the
// raw socket after a non-websocket 101 (incus file push/pull use SFTP over an
// HTTP upgrade), and Bun's fetch skips checkServerIdentity when
// rejectUnauthorized is false, so the upstream side uses the SDK's
// PinnedAgent (fingerprint pinning before any byte is written).
import { createServer, request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { readFileSync } from "node:fs";
import { PinnedAgent } from "../../packages/api/src/node.ts";

const dev = new URL("../.dev/", import.meta.url);
const pem = readFileSync(new URL("incus-a.crt", dev), "utf8");
const clusters: Record<string, { url: URL; agent: PinnedAgent }> = {
  local: { url: new URL("https://127.0.0.1:8443"), agent: new PinnedAgent({ pin: process.env.PIN ?? pem }) },
};
const CLUSTER_DOMAIN = process.env.CLUSTER_DOMAIN ?? "127.0.0.1.nip.io";
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"]);

function route(req: IncomingMessage) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const path = req.url ?? "/";
  if (host.endsWith(`.${CLUSTER_DOMAIN}`)) {
    const c = clusters[host.slice(0, -CLUSTER_DOMAIN.length - 1)];
    return c ? { c, path } : null;
  }
  const m = path.match(/^\/clusters\/([^/?]+)(.*)$/);
  const c = m && clusters[m[1]];
  return c ? { c, path: m![2] || "/" } : null;
}

const errorBody = (code: number, error: string) =>
  JSON.stringify({ type: "error", status: "", status_code: 0, operation: "", error_code: code, error, metadata: null });

function upstreamHeaders(req: IncomingMessage, c: { url: URL }, keepUpgrade: boolean) {
  const h: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k === "host") continue;
    if (HOP.has(k) && !(keepUpgrade && (k === "upgrade" || k === "connection"))) continue;
    h[k] = v;
  }
  h.host = c.url.host;
  h["x-forwarded-for"] = req.socket.remoteAddress ?? "";
  return h;
}

/** Unauthenticated callers may read /1.0 only (Incus reports "untrusted" plus its OIDC headers). */
const allowedWithoutToken = (path: string) => path === "/1.0" || path.startsWith("/1.0?");

let peakRss = 0;
setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 200);

const server = createServer({
  cert: readFileSync(new URL("tls/server.crt", dev)),
  key: readFileSync(new URL("tls/server.key", dev)),
});

server.on("request", (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/_stats") {
    res.end(JSON.stringify({ peakRssMiB: Math.round(peakRss / 2 ** 20) }));
    return;
  }
  const r = route(req);
  const fail = (code: number, msg: string) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(errorBody(code, msg));
  };
  if (!r) return fail(404, "Unknown cluster");
  if (!req.headers.authorization?.startsWith("Bearer ") && !allowedWithoutToken(r.path)) {
    return fail(401, "Missing bearer token");
  }
  const up = httpsRequest(
    { protocol: "https:", hostname: r.c.url.hostname, port: r.c.url.port, path: r.path, method: req.method, headers: upstreamHeaders(req, r.c, false), agent: r.c.agent },
    (ures) => {
      const h: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(ures.headers)) if (v !== undefined && !HOP.has(k)) h[k] = v;
      res.writeHead(ures.statusCode ?? 502, h);
      ures.pipe(res);
    },
  );
  up.on("error", (e) => (res.headersSent ? res.destroy() : fail(502, `Cluster unreachable: ${e.message}`)));
  req.pipe(up);
});

server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const reject = (code: number, msg: string) => {
    const body = errorBody(code, msg);
    socket.end(`HTTP/1.1 ${code} Error\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
  };
  const r = route(req);
  if (!r) return reject(404, "Unknown cluster");
  if (!req.headers.authorization?.startsWith("Bearer ")) return reject(401, "Missing bearer token");
  const up = httpsRequest({ protocol: "https:", hostname: r.c.url.hostname, port: r.c.url.port, path: r.path, method: req.method, headers: upstreamHeaders(req, r.c, true), agent: r.c.agent });
  up.on("upgrade", (ures, usocket, uhead) => {
    let head101 = `HTTP/1.1 ${ures.statusCode} ${ures.statusMessage}\r\n`;
    for (let i = 0; i < ures.rawHeaders.length; i += 2) head101 += `${ures.rawHeaders[i]}: ${ures.rawHeaders[i + 1]}\r\n`;
    socket.write(`${head101}\r\n`);
    if (uhead.length) socket.write(uhead);
    if (head.length) usocket.write(head);
    usocket.pipe(socket).pipe(usocket);
    const end = () => { socket.destroy(); usocket.destroy(); };
    socket.on("error", end); usocket.on("error", end); socket.on("close", end); usocket.on("close", end);
  });
  up.on("response", (ures) => {
    // Upstream refused the upgrade: relay its answer as a normal response.
    let raw = `HTTP/1.1 ${ures.statusCode} ${ures.statusMessage}\r\n`;
    for (let i = 0; i < ures.rawHeaders.length; i += 2) if (!/^(transfer-encoding|connection)$/i.test(ures.rawHeaders[i])) raw += `${ures.rawHeaders[i]}: ${ures.rawHeaders[i + 1]}\r\n`;
    socket.write(`${raw}connection: close\r\n\r\n`);
    ures.pipe(socket);
  });
  up.on("error", (e) => reject(502, `Cluster unreachable: ${e.message}`));
  up.end();
});

server.listen(9443, "0.0.0.0", () => console.log("proxy on :9443"));
