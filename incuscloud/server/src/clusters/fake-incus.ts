import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { createServer as createTlsServer, type Server } from "node:tls";
import { X509Certificate, createHash } from "node:crypto";
import { WebSocketServer, type WebSocket } from "../lib/ws.ts";

/**
 * Minimal websocket echo (small frames only): Bun's `ws` server shim cannot
 * take over a socket handed to an `upgrade` listener.
 */
function websocketEcho(req: IncomingMessage, socket: Duplex) {
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buf = Buffer.alloc(0);
  socket.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 6) {
      const opcode = buf[0]! & 0x0f;
      const len = buf[1]! & 0x7f; // < 126: small frames only
      if (buf.length < 6 + len) return;
      const mask = buf.subarray(2, 6);
      const payload = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4]!));
      buf = buf.subarray(6 + len);
      socket.write(Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]));
      if (opcode === 0x8) socket.end();
    }
  });
}

export const fixtureCert = readFileSync(new URL("../test/fixtures/test.crt", import.meta.url), "utf8");
const fixtureKey = readFileSync(new URL("../test/fixtures/test.key", import.meta.url), "utf8");

export interface SeenRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  bodyBytes: number;
  clientFingerprint: string;
}

/**
 * A tiny Incus look-alike over TLS. Trusts a client certificate after a valid
 * trust token, and has test endpoints for the gateway: /1.0/echo,
 * /1.0/stream?bytes=N, /1.0/slow, websocket /1.0/ws, `Upgrade: sftp` /1.0/sftp.
 */
export class FakeIncus {
  server!: Server;
  port = 0;
  trusted = new Set<string>();
  tokenSecret = "s3cret";
  certificatesPosted: Array<{ body: Record<string, unknown>; clientFingerprint: string }> = [];
  deletedCertificates: string[] = [];
  requests: SeenRequest[] = [];
  upgrades: SeenRequest[] = [];
  slowClosed = 0;
  /** Server config (`GET/PATCH /1.0`), projects and their profiles, pools and networks, for reconciler tests. */
  config: Record<string, string> = {};
  projects = new Map<
    string,
    {
      config: Record<string, string>;
      description: string;
      profiles: Map<string, { config: Record<string, string>; devices: Record<string, Record<string, string>> }>;
      /** What `GET /1.0/projects/<p>/state` reports as used; none when unset. */
      usage?: Record<"instances" | "cpu" | "memory" | "disk", number>;
    }
  >([
    ["default", { config: {}, description: "Default Incus project", profiles: new Map([["default", { config: {}, devices: { root: { type: "disk", path: "/", pool: "local" }, eth0: { type: "nic", name: "eth0", network: "incusbr0" } } }]]) }],
  ]);
  pools = [{ name: "local", driver: "dir" }];
  networks = [{ name: "incusbr0", type: "bridge", managed: true }];
  patches: Array<{ path: string; body: unknown }> = [];
  /** Answers first when set: tests' own endpoints (status, JSON body, content type). */
  respond?: (r: { method: string; url: string; body: string; headers: IncomingMessage["headers"] }) => { status?: number; body: unknown; type?: string } | undefined;
  /** Open `/1.0/events` sockets; `emit` sends to all of them. */
  eventSockets: WebSocket[] = [];
  private wss = new WebSocketServer({ noServer: true });
  /** Operation id → websocket secret: `/1.0/operations/<id>/websocket?secret=` echoes when it matches. */
  operationSockets = new Map<string, string>();

  async start() {
    // Bun's https server exposes no peer certificate: terminate TLS here,
    // remember the client fingerprint, then hand the socket to plain HTTP.
    const peers = new WeakMap<object, string>();
    const http = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
      const fp = peers.get(req.socket) ?? "";
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const sync = (metadata: unknown) => send(200, { type: "sync", status: "Success", status_code: 200, metadata });
      const fail = (status: number, error: string) => send(status, { type: "error", error_code: status, error });
      const seen: SeenRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, bodyBytes: 0, clientFingerprint: fp };
      this.requests.push(seen);

      if (req.url?.startsWith("/1.0/stream")) {
        let left = Number(new URL(req.url, "http://x").searchParams.get("bytes") ?? 0);
        const chunk = Buffer.alloc(1 << 20, 7);
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(left) });
        const pump = () => {
          while (left > 0) {
            const n = Math.min(left, chunk.length);
            left -= n;
            if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return res.once("drain", pump);
          }
          res.end();
        };
        return pump();
      }
      // Uploads: answers with the size and hash of the whole body, and the headers it came with.
      if (req.url === "/1.0/sink") {
        const h = createHash("sha256");
        let bytes = 0;
        req.on("data", (d: Buffer) => {
          h.update(d);
          bytes += d.length;
        });
        req.on("end", () => sync({ bytes, sha256: h.digest("hex"), headers: req.headers }));
        return;
      }
      if (req.url === "/1.0/slow") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("started");
        res.on("close", () => this.slowClosed++);
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => {
        seen.bodyBytes += d.length;
        if (seen.bodyBytes < 1 << 20) chunks.push(d);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        if (req.url === "/1.0/echo") {
          return sync({ method: req.method, headers: req.headers, bodyBytes: seen.bodyBytes });
        }
        const own = this.respond?.({ method: req.method ?? "", url: req.url ?? "", body: raw, headers: req.headers });
        if (own) {
          const type = own.type ?? "application/json";
          res.writeHead(own.status ?? 200, { "content-type": type });
          return res.end(type === "application/json" ? JSON.stringify(own.body) : (own.body as string));
        }
        const admin = this.trusted.has(fp);
        const u = new URL(req.url ?? "/", "https://x");
        const project = u.searchParams.get("project") ?? "default";
        const body = () => JSON.parse(raw || "{}");
        if (req.method === "GET" && req.url === "/1.0") {
          return sync({ auth: admin || !!req.headers.authorization ? "trusted" : "untrusted", api_extensions: ["certificate_token"], config: admin ? this.config : undefined, environment: { certificate: fixtureCert, server_clustered: true, server_name: "m1", server_version: "7.5.1" } });
        }
        if (admin && req.method === "PATCH" && req.url === "/1.0") {
          this.patches.push({ path: "/1.0", body: body() });
          for (const [k, v] of Object.entries(body().config ?? {})) {
            if (v === "") delete this.config[k];
            else this.config[k] = String(v);
          }
          return sync({});
        }
        if (admin && u.pathname === "/1.0/projects" && req.method === "POST") {
          const b = body();
          if (this.projects.has(b.name)) return fail(409, "Project already exists");
          this.projects.set(b.name, { config: b.config ?? {}, description: b.description ?? "", profiles: new Map([["default", { config: {}, devices: {} }]]) });
          return sync({});
        }
        const ps = u.pathname.match(/^\/1\.0\/projects\/([^/]+)\/state$/);
        if (admin && ps && req.method === "GET") {
          const p = this.projects.get(decodeURIComponent(ps[1]!));
          if (!p) return fail(404, "Project not found");
          const used = p.usage ?? { instances: 0, cpu: 0, memory: 0, disk: 0 };
          const limit = (k: string) => (p.config[`limits.${k}`] ? Number(p.config[`limits.${k}`]) : -1);
          return sync({ resources: Object.fromEntries((["instances", "cpu", "memory", "disk", "networks"] as const).map((k) => [k, { Limit: limit(k), Usage: k === "networks" ? 0 : used[k] }])) });
        }
        const pm = u.pathname.match(/^\/1\.0\/projects\/([^/]+)$/);
        if (admin && pm) {
          const p = this.projects.get(decodeURIComponent(pm[1]!));
          if (!p) return fail(404, "Project not found");
          if (req.method === "GET") return sync({ name: pm[1], config: p.config, description: p.description });
          if (req.method === "PATCH" || req.method === "PUT") {
            this.patches.push({ path: u.pathname, body: body() });
            const sent = (body().config ?? {}) as Record<string, string>;
            // Incus refuses a limit below what the project already uses.
            for (const [k, v] of Object.entries(sent)) {
              const key = k.replace(/^limits\./, "") as "instances" | "cpu" | "memory" | "disk";
              if (k.startsWith("limits.") && v !== "" && p.usage && key in p.usage && Number(v) < p.usage[key]) return fail(400, `Invalid limit ${k}: below current usage`);
            }
            // As Incus 7.5 does for PATCH too (projectPatch merges into a copy it then ignores): the config sent replaces the project's.
            p.config = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)]));
            if (body().description !== undefined) p.description = body().description;
            return sync({});
          }
        }
        const prof = u.pathname.match(/^\/1\.0\/profiles\/([^/]+)$/);
        if (admin && prof) {
          const p = this.projects.get(project);
          const profile = p?.profiles.get(decodeURIComponent(prof[1]!));
          if (!profile) return fail(404, "Profile not found");
          if (req.method === "GET") return sync({ name: prof[1], ...profile });
          if (req.method === "PUT") {
            this.patches.push({ path: `${u.pathname}?project=${project}`, body: body() });
            const b = body();
            p!.profiles.set(prof[1]!, { config: b.config ?? {}, devices: b.devices ?? {} });
            return sync({});
          }
        }
        if (admin && req.method === "GET" && u.pathname === "/1.0/storage-pools") return sync(this.pools);
        if (admin && req.method === "GET" && u.pathname === "/1.0/networks") return sync(this.networks);
        if (req.method === "POST" && req.url === "/1.0/certificates") {
          const body = JSON.parse(raw || "{}");
          this.certificatesPosted.push({ body, clientFingerprint: fp });
          // Like Incus: trust_token is the whole token, decoded server side.
          let secret = "";
          try {
            secret = JSON.parse(Buffer.from(String(body.trust_token), "base64").toString()).secret;
          } catch {}
          if (secret !== this.tokenSecret) return fail(403, "No matching certificate add operation found");
          this.trusted.add(fp);
          return sync({});
        }
        if (req.method === "DELETE" && req.url?.startsWith("/1.0/certificates/")) {
          if (!this.trusted.has(fp)) return fail(403, "not authorized");
          this.deletedCertificates.push(req.url.slice("/1.0/certificates/".length));
          this.trusted.delete(fp);
          return sync({});
        }
        const opm = u.pathname.match(/^\/1\.0\/operations\/([^/]+)$/);
        if (admin && opm && req.method === "DELETE") {
          if (!this.operationSockets.delete(opm[1]!)) return fail(404, "Operation not found");
          return sync({});
        }
        if (req.method === "GET" && req.url === "/1.0/boom") return fail(500, "kaboom");
        return fail(404, "not found");
      });
    });
    http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.upgrades.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, bodyBytes: 0, clientFingerprint: peers.get(req.socket) ?? "" });
      if (req.url === "/1.0/ws") {
        return websocketEcho(req, socket);
      }
      if (req.url?.startsWith("/1.0/events")) {
        return this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.eventSockets.push(ws);
          ws.on("close", () => (this.eventSockets = this.eventSockets.filter((x) => x !== ws)));
        });
      }
      const opws = new URL(req.url ?? "/", "https://x");
      const opid = opws.pathname.match(/^\/1\.0\/operations\/([^/]+)\/websocket$/)?.[1];
      if (opid) {
        if (this.operationSockets.get(opid) === opws.searchParams.get("secret")) return websocketEcho(req, socket);
        return socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
      }
      if (req.url === "/1.0/sftp" && req.headers.upgrade === "sftp") {
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: sftp\r\nConnection: Upgrade\r\n\r\n");
        if (head.length) socket.write(head);
        return socket.pipe(socket); // raw echo
      }
      const body = JSON.stringify({ type: "error", error_code: 404, error: "not found" });
      socket.end(`HTTP/1.1 404 Not Found\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`);
    });
    this.server = createTlsServer({ cert: fixtureCert, key: fixtureKey, requestCert: true, rejectUnauthorized: false }, (socket) => {
      peers.set(socket, (socket.getPeerCertificate()?.fingerprint256 ?? "").replaceAll(":", "").toLowerCase());
      http.emit("connection", socket);
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  get url() {
    return `https://127.0.0.1:${this.port}`;
  }

  get fingerprint() {
    return new X509Certificate(fixtureCert).fingerprint256.replaceAll(":", "").toLowerCase();
  }

  token(overrides: Record<string, unknown> = {}) {
    return Buffer.from(JSON.stringify({ client_name: "incuscloud", fingerprint: this.fingerprint, addresses: [`127.0.0.1:${this.port}`], secret: this.tokenSecret, expires_at: "2099-01-01T00:00:00Z", ...overrides })).toString("base64");
  }

  emit(event: unknown) {
    for (const ws of this.eventSockets) ws.send(JSON.stringify(event));
  }

  stop() {
    for (const ws of this.eventSockets) ws.terminate();
    this.server.close();
  }
}
