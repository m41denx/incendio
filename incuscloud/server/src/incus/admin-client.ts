import { request as httpsRequest } from "node:https";
import { PinnedAgent } from "@incendio/api/node";
import { ApiError } from "../lib/errors.ts";

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

  /** Sends a request; resolves the Incus envelope, throws ApiError(502) on Incus errors. */
  request<T = unknown>(method: string, path: string, body?: unknown, opts: { project?: string } = {}): Promise<IncusResponse<T>> {
    const u = new URL(this.url + path);
    if (opts.project) u.searchParams.set("project", opts.project);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: this.agent, headers: { "content-type": "application/json" }, timeout: this.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (d: Buffer) => chunks.push(d));
          res.on("end", () => {
            let parsed: IncusResponse<T>;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              return reject(new ApiError(502, "cluster_error", `Cluster answered ${res.statusCode} without JSON`));
            }
            if (parsed.type === "error") {
              return reject(new ClusterError(parsed.error_code ?? res.statusCode ?? 0, `Cluster: ${parsed.error}`));
            }
            resolve(parsed);
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (e) => reject(new ApiError(502, "cluster_unreachable", `Could not reach ${this.url}: ${e.message}`)));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
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
