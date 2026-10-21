import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PinnedAgent } from "@incendio/api/node";
import { ApiError } from "../lib/errors.ts";

import { WebSocket } from "../lib/ws.ts";

/** An error answer from a cluster; `clusterStatus` is Incus's HTTP status (404, 409, …). */
export class ClusterError extends ApiError {
  constructor(
    readonly clusterStatus: number,
    message: string,
  ) {
    super(502, "cluster_error", message);
  }
}

export interface IncusResponse<T = unknown> {
  type: "sync" | "async" | "error";
  status_code: number;
  metadata: T;
  operation?: string;
  error?: string;
  error_code?: number;
}

export interface IncusOperation {
  id: string;
  status: string;
  status_code: number;
  err: string;
  metadata: Record<string, unknown> | null;
  resources: Record<string, string[]> | null;
}

export interface IncusServer {
  auth: "trusted" | "untrusted";
  api_extensions: string[];
  config?: Record<string, string>;
  environment: { certificate: string; server_clustered: boolean; server_name: string; server_version: string; addresses?: string[] };
}

const reasonOf = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new Error("aborted"));

/** Reads an Incus JSON answer: the envelope, or a ClusterError with the Incus message. */
function envelope<T>(res: IncomingMessage): Promise<IncusResponse<T>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (d: Buffer) => chunks.push(d));
    res.on("error", reject);
    res.on("end", () => {
      let parsed: IncusResponse<T>;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reject(new ApiError(502, "cluster_error", `Cluster answered ${res.statusCode} without JSON`));
      }
      if (parsed.type === "error") return reject(new ClusterError(parsed.error_code ?? res.statusCode ?? 0, `Cluster: ${parsed.error}`));
      resolve(parsed);
    });
  });
}

export interface AdminClientOptions {
  url: string;
  fingerprint: string;
  cert: string;
  key: string;
  timeoutMs?: number;
}

/**
 * The control plane's own Incus client: mutual TLS with its per-cluster
 * certificate, the server pinned by fingerprint (never the gateway path).
 */
export class IncusAdminClient {
  readonly url: string;
  private readonly agent: PinnedAgent;
  private readonly timeoutMs: number;

  constructor(opts: AdminClientOptions) {
    this.url = opts.url.replace(/\/$/, "");
    this.agent = new PinnedAgent({ pin: opts.fingerprint, cert: opts.cert, key: opts.key });
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private url_(path: string, project?: string): URL {
    const u = new URL(this.url + path);
    if (project) u.searchParams.set("project", project);
    return u;
  }

  /** Sends a request; resolves the Incus envelope, throws ApiError(502) on Incus errors. */
  request<T = unknown>(method: string, path: string, body?: unknown, opts: { project?: string } = {}): Promise<IncusResponse<T>> {
    const u = this.url_(path, opts.project);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: this.agent, headers: { "content-type": "application/json" }, timeout: this.timeoutMs },
        (res) => envelope<T>(res).then(resolve, reject),
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (e) => reject(new ApiError(502, "cluster_unreachable", `Could not reach ${this.url}: ${e.message}`)));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  /**
   * Reads a raw answer (a backup export, or a direct backup: a POST with a JSON
   * body and `Accept: application/octet-stream`) as a stream; an error answer is
   * a ClusterError. The signal stops it.
   */
  download(path: string, opts: { project?: string; signal?: AbortSignal; method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ReadableStream<Uint8Array>> {
    const u = this.url_(path, opts.project);
    const headers = { ...(opts.body !== undefined && { "content-type": "application/json" }), ...opts.headers };
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method ?? "GET", headers, agent: this.agent, timeout: this.timeoutMs, signal: opts.signal }, (res) => {
        if ((res.statusCode ?? 0) >= 400) return envelope(res).then(() => reject(new ClusterError(res.statusCode ?? 502, `Cluster answered ${res.statusCode}`)), reject);
        // The stream errors with the signal's reason when it aborts.
        opts.signal?.addEventListener("abort", () => res.destroy(reasonOf(opts.signal!)), { once: true });
        resolve(Readable.toWeb(res) as ReadableStream<Uint8Array>);
      });
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (e) => reject(opts.signal?.aborted ? reasonOf(opts.signal) : new ApiError(502, "cluster_unreachable", `Could not reach ${this.url}: ${e.message}`)));
      req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
    });
  }

  /** POSTs a raw body (a backup to import) as a stream, with backpressure; resolves the Incus envelope. */
  upload<T = unknown>(path: string, body: ReadableStream<Uint8Array>, opts: { project?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<IncusResponse<T>> {
    const u = this.url_(path, opts.project);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", agent: this.agent, timeout: this.timeoutMs, headers: { "content-type": "application/octet-stream", ...opts.headers } },
        (res) => envelope<T>(res).then(resolve, reject),
      );
      const fail = (e: unknown) => reject(opts.signal?.aborted ? reasonOf(opts.signal) : new ApiError(502, "cluster_unreachable", `Could not reach ${this.url}: ${(e as Error).message}`));
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", fail);
      const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
      opts.signal?.addEventListener(
        "abort",
        () => {
          source.destroy();
          req.destroy(reasonOf(opts.signal!));
        },
        { once: true },
      );
      pipeline(source, req).catch(fail);
    });
  }

  /** Opens an operation websocket (`/1.0/operations/<id>/websocket?secret=…`), pinned like every request. */
  websocket(path: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url.replace(/^https:/, "wss:") + path, { agent: this.agent, handshakeTimeout: this.timeoutMs, maxPayload: 0 });
      ws.once("open", () => resolve(ws));
      ws.once("error", (e) => reject(new ApiError(502, "cluster_unreachable", `Websocket to ${this.url}: ${e.message}`)));
    });
  }

  /** Cancels an operation (its path or id); one already gone is fine. */
  async cancel(op: string): Promise<void> {
    try {
      await this.request("DELETE", op.startsWith("/") ? op : `/1.0/operations/${op}`);
    } catch (e) {
      if (!(e instanceof ClusterError && e.clusterStatus === 404)) throw e;
    }
  }

  /** GET /1.0 */
  async server(): Promise<IncusServer> {
    return (await this.request<IncusServer>("GET", "/1.0")).metadata;
  }

  /** Waits for an operation (`/1.0/operations/<id>` or its id) to finish; throws if it failed. */
  async wait(op: string, timeoutS = 600): Promise<IncusOperation> {
    const path = op.startsWith("/") ? op : `/1.0/operations/${op}`;
    const r = await this.request<IncusOperation>("GET", `${path}/wait?timeout=${timeoutS}`);
    if (r.metadata.status !== "Success") {
      throw new ApiError(502, "operation_failed", `Cluster operation ${r.metadata.status}: ${r.metadata.err}`);
    }
    return r.metadata;
  }
}
