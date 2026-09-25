/**
 * Node.js / Bun transport helpers: mutual-TLS over HTTPS and the local unix
 * socket, including websockets (via the optional `ws` peer dependency), and
 * certificate pinning for self-signed servers.
 *
 * @example
 * import { createIncusClient } from "@incendio/api";
 * import { nodeTransport } from "@incendio/api/node";
 *
 * // Local daemon over the unix socket
 * const local = createIncusClient(nodeTransport());
 *
 * // Remote daemon with a client certificate, pinning its server certificate
 * const remote = createIncusClient({
 *   ...nodeTransport({
 *     url: "https://incus.example.com:8443",
 *     cert: readFileSync("client.crt"),
 *     key: readFileSync("client.key"),
 *     serverCert: readFileSync("server.crt", "utf8"),
 *   }),
 *   project: "default",
 * });
 */
import { X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { Agent, type AgentOptions, type RequestOptions } from "node:https";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { connect, type TLSSocket } from "node:tls";
import type { CreateAxiosDefaults } from "axios";
import type {
  IncusClientOptions,
  WebSocketConnector,
  WebSocketLike,
} from "./api/base/types";
import { normalizeFingerprint } from "./utils/certificates";

type Pem = string | Buffer;

/** A server certificate as PEM, or its SHA-256 fingerprint (any common spelling). */
export type CertificatePin = string | Buffer;

const pinFingerprint = (pin: CertificatePin): string => {
  const text = pin.toString();
  return text.includes("BEGIN CERTIFICATE")
    ? normalizeFingerprint(new X509Certificate(text).fingerprint256)
    : normalizeFingerprint(text);
};

/**
 * HTTPS agent that trusts exactly one server certificate, by SHA-256
 * fingerprint — the trust decision `incus remote add` makes.
 *
 * Incus and the Kubernetes agent serve self-signed *leaf* certificates whose
 * SANs usually omit the address being dialed, so `ca` cannot express this
 * (Bun rejects a leaf as a trust anchor, and hostname checks fail anyway).
 * Chain validation is skipped and the peer fingerprint compared instead; the
 * socket reaches the HTTP layer only after it matches, so no request bytes or
 * client-certificate auth go to an unpinned server.
 */
export class PinnedAgent extends Agent {
  readonly fingerprint: string;

  constructor({ pin, ...options }: AgentOptions & { pin: CertificatePin }) {
    super({ keepAlive: true, ...options });
    this.fingerprint = pinFingerprint(pin);
  }

  override createConnection(
    options: RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const socket: TLSSocket = connect({
      ...(options as object),
      rejectUnauthorized: false,
    });
    const done = (err: Error | null) => callback?.(err, socket);
    const onError = (err: Error) => done(err);
    socket.once("error", onError);
    socket.once("secureConnect", () => {
      socket.off("error", onError);
      const presented = normalizeFingerprint(
        socket.getPeerCertificate().fingerprint256 ?? "",
      );
      if (presented !== this.fingerprint) {
        // No error arg: that would emit an unhandled 'error' on the socket.
        socket.destroy();
        done(
          new Error(
            `Server certificate sha256:${presented} does not match the pinned sha256:${this.fingerprint}`,
          ),
        );
        return;
      }
      done(null);
    });
    // Returning nothing makes the agent wait for the callback.
    return undefined;
  }
}

/** Axios defaults that pin a self-signed server certificate. */
export const pinnedAxios = (
  pin: CertificatePin,
  options: AgentOptions = {},
): CreateAxiosDefaults => ({
  httpsAgent: new PinnedAgent({ ...options, pin }),
});

export interface NodeTransportOptions {
  /** `https://host:8443`. Omit to use the local unix socket. */
  url?: string;
  /** Unix socket path. Default: see `defaultSocketPath()`. */
  socket?: string;
  /** Client certificate (PEM) for mutual TLS. */
  cert?: Pem;
  /** Client private key (PEM). */
  key?: Pem;
  /**
   * The server certificate (PEM) or its SHA-256 fingerprint. Pins exactly
   * that certificate — the right choice for Incus's self-signed certificate.
   */
  serverCert?: CertificatePin;
  /** CA bundle for servers with a CA-issued certificate (PEM). */
  ca?: Pem;
  /** Skip server certificate verification entirely (testing only). */
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

const httpsAgentFor = (opts: NodeTransportOptions): Agent =>
  opts.serverCert
    ? new PinnedAgent({ cert: opts.cert, key: opts.key, pin: opts.serverCert })
    : new Agent({
        cert: opts.cert,
        key: opts.key,
        ca: opts.ca,
        rejectUnauthorized: !opts.insecure,
        keepAlive: true,
      });

/** A websocket connector for Node using the `ws` package. */
export const nodeWebSocketConnector = (
  opts: NodeTransportOptions = {},
): WebSocketConnector => {
  // One agent per connector: the pinning check runs on every new socket.
  const agent = opts.url ? httpsAgentFor(opts) : undefined;
  return async (path) => {
    const WebSocket = await loadWs();
    const socket = opts.url
      ? new WebSocket(
          opts.url.replace(/\/+$/, "").replace(/^http/, "ws") + path,
          { agent },
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
      axios: { httpsAgent: httpsAgentFor(opts) },
      websocket,
    };
  }
  return {
    url: "http://unix.socket",
    axios: { socketPath: opts.socket ?? defaultSocketPath() },
    websocket,
  };
};

/**
 * Options for `createK8sClient` in Node: pins the Kubernetes agent's
 * self-signed certificate (fingerprint from the Incus-stored agent handle).
 */
export const nodeK8sOptions = {
  agentTransport: (pin: { fingerprint: string }): CreateAxiosDefaults =>
    pinnedAxios(pin.fingerprint),
};
