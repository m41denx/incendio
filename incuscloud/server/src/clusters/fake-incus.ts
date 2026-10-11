import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer as createTlsServer, type Server } from "node:tls";
import { X509Certificate } from "node:crypto";

export const fixtureCert = readFileSync(new URL("../test/fixtures/test.crt", import.meta.url), "utf8");
const fixtureKey = readFileSync(new URL("../test/fixtures/test.key", import.meta.url), "utf8");

/** A tiny Incus look-alike: trusts a client certificate after a valid trust token. */
export class FakeIncus {
  server!: Server;
  port = 0;
  trusted = new Set<string>();
  tokenSecret = "s3cret";
  certificatesPosted: Array<{ body: Record<string, unknown>; clientFingerprint: string }> = [];
  deletedCertificates: string[] = [];

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
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        if (req.method === "GET" && req.url === "/1.0") {
          return sync({ auth: this.trusted.has(fp) ? "trusted" : "untrusted", api_extensions: ["certificate_token"], environment: { certificate: fixtureCert, server_clustered: true, server_name: "m1", server_version: "7.5.1" } });
        }
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
        if (req.method === "GET" && req.url === "/1.0/boom") return fail(500, "kaboom");
        return fail(404, "not found");
      });
    });
    this.server = createTlsServer({ cert: fixtureCert, key: fixtureKey, requestCert: true, rejectUnauthorized: false }, (socket) => {
      peers.set(socket, (socket.getPeerCertificate()?.fingerprint256 ?? "").replaceAll(":", "").toLowerCase());
      http.emit("connection", socket);
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  token(overrides: Record<string, unknown> = {}) {
    const fp = new X509Certificate(fixtureCert).fingerprint256.replaceAll(":", "").toLowerCase();
    return Buffer.from(JSON.stringify({ client_name: "incuscloud", fingerprint: fp, addresses: [`127.0.0.1:${this.port}`], secret: this.tokenSecret, expires_at: "2099-01-01T00:00:00Z", ...overrides })).toString("base64");
  }

  stop() {
    this.server.close();
  }
}
