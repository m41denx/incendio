import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, type Duplex } from "node:stream";
import { log } from "./lib/log.ts";

/**
 * Traffic the gateway owns (cluster API, host- or path-routed). It gets the
 * raw node request so bodies and upgrades (websocket, `Upgrade: sftp`) pass
 * through untouched; see docs/spikes.md §B.
 */
export interface GatewayHandler {
  match(req: IncomingMessage): boolean;
  request(req: IncomingMessage, res: ServerResponse): void;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export interface FrontOptions {
  app: { handle(request: Request): Promise<Response> | Response };
  gateway?: GatewayHandler;
  tls: { cert: string | Buffer; key: string | Buffer };
}

/** Converts a node request into a fetch Request for the Elysia app. */
export function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(origin + (req.url ?? "/"), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
}

/** Writes a fetch Response to a node response, streaming its body. */
export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((v, k) => {
    if (k === "set-cookie") return;
    headers[k] = v;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as never).pipe(res);
}

/** The single HTTPS listener: gateway traffic to the gateway, the rest to the app. */
export function createFront({ app, gateway, tls }: FrontOptions): Server {
  const server = createServer({ cert: tls.cert, key: tls.key });
  server.on("request", (req, res) => {
    if (gateway?.match(req)) return gateway.request(req, res);
    const origin = `https://${req.headers.host ?? "localhost"}`;
    Promise.resolve(app.handle(toRequest(req, origin)))
      .then((response) => writeResponse(res, response))
      .catch((e: unknown) => {
        log.error("app request failed", { error: String(e), url: req.url });
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "internal", message: "Internal error" } }));
      });
  });
  server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
    if (gateway?.match(req)) return gateway.upgrade(req, socket, head);
    socket.destroy();
  });
  return server;
}
