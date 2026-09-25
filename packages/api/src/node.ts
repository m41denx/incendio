/**
 * Node.js / Bun transport helpers: mutual-TLS over HTTPS and the local unix
 * socket, including websockets (via the optional `ws` peer dependency).
 *
 * @example
 * import { createIncusClient } from "@incendio/api";
 * import { nodeTransport } from "@incendio/api/node";
 *
 * // Local daemon over the unix socket
 * const local = createIncusClient(nodeTransport());
 *
 * // Remote daemon with a client certificate
 * const remote = createIncusClient({
 *   ...nodeTransport({
 *     url: "https://incus.example.com:8443",
 *     cert: readFileSync("client.crt"),
 *     key: readFileSync("client.key"),
 *     insecure: true,
 *   }),
 *   project: "default",
 * });
 */
import { existsSync } from "node:fs";
import { Agent } from "node:https";
import { join } from "node:path";
import type {
  IncusClientOptions,
  WebSocketConnector,
  WebSocketLike,
} from "./api/base/types";

type Pem = string | Buffer;

export interface NodeTransportOptions {
  /** `https://host:8443`. Omit to use the local unix socket. */
  url?: string;
  /** Unix socket path. Default: see `defaultSocketPath()`. */
  socket?: string;
  /** Client certificate (PEM) for mutual TLS. */
  cert?: Pem;
  /** Client private key (PEM). */
  key?: Pem;
  /** CA / server certificate to trust (PEM). */
  ca?: Pem;
  /** Skip server certificate verification (self-signed daemons). */
  insecure?: boolean;
}

/**
 * The local daemon socket: `$INCUS_SOCKET`, `$INCUS_DIR/unix.socket`, or the
 * first existing of `/var/lib/incus/unix.socket` and `/run/incus/unix.socket`.
 */
export const defaultSocketPath = (): string => {
  if (process.env.INCUS_SOCKET) return process.env.INCUS_SOCKET;
  if (process.env.INCUS_DIR) return join(process.env.INCUS_DIR, "unix.socket");
  const candidates = ["/var/lib/incus/unix.socket", "/run/incus/unix.socket"];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
};

const loadWs = async () => {
  try {
    const mod = await import("ws");
    return (mod.default ?? mod.WebSocket) as unknown as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => WebSocketLike;
  } catch {
    throw new Error("Websockets in Node need the `ws` package: npm install ws");
  }
};

/** A websocket connector for Node using the `ws` package. */
export const nodeWebSocketConnector = (
  opts: NodeTransportOptions = {},
): WebSocketConnector => {
  return async (path) => {
    const WebSocket = await loadWs();
    const socket = opts.url
      ? new WebSocket(
          opts.url.replace(/\/+$/, "").replace(/^http/, "ws") + path,
          {
            cert: opts.cert,
            key: opts.key,
            ca: opts.ca,
            rejectUnauthorized: !opts.insecure,
          },
        )
      : new WebSocket(
          `ws+unix://${opts.socket ?? defaultSocketPath()}:${path}`,
        );
    socket.binaryType = "arraybuffer";
    return socket;
  };
};

/**
 * Client options for talking to Incus from Node: HTTPS with an mTLS agent
 * when `url` is set, the unix socket otherwise.
 */
export const nodeTransport = (
  opts: NodeTransportOptions = {},
): Pick<IncusClientOptions, "url" | "axios" | "websocket"> => {
  const websocket = nodeWebSocketConnector(opts);
  if (opts.url) {
    return {
      url: opts.url,
      axios: {
        httpsAgent: new Agent({
          cert: opts.cert,
          key: opts.key,
          ca: opts.ca,
          rejectUnauthorized: !opts.insecure,
          keepAlive: true,
        }),
      },
      websocket,
    };
  }
  return {
    url: "http://unix.socket",
    axios: { socketPath: opts.socket ?? defaultSocketPath() },
    websocket,
  };
};
