import type { AxiosInstance, CreateAxiosDefaults } from "axios";
import type { Operation } from "../types/generated";

/** Response envelope for synchronous requests. */
export interface IncusSyncResponse<T> {
  type: "sync";
  status: string;
  status_code: number;
  operation: string;
  error_code: number;
  error: string;
  metadata: T;
}

/** Response envelope for requests that started a background operation. */
export interface IncusAsyncResponse {
  type: "async";
  status: string;
  status_code: number;
  /** Operation URL, e.g. `/1.0/operations/<uuid>` */
  operation: string;
  error_code: number;
  error: string;
  metadata: Operation;
}

export interface IncusErrorResponse {
  type: "error";
  error: string;
  error_code: number;
  metadata?: unknown;
}

export type IncusResponse<T = unknown> =
  | IncusSyncResponse<T>
  | IncusAsyncResponse
  | IncusErrorResponse;

/** An error returned by the Incus daemon (or a transport failure). */
export class IncusError extends Error {
  /** HTTP status, or 0 when no response was received */
  readonly status: number;
  /** Incus `error_code` (usually equal to the HTTP status) */
  readonly code: number;
  /** Raw response body, if any */
  readonly data?: unknown;

  constructor(message: string, status: number, code?: number, data?: unknown) {
    super(message);
    this.name = "IncusError";
    this.status = status;
    this.code = code ?? status;
    this.data = data;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isConflict() {
    return this.status === 409;
  }

  /** The request used a stale ETag (`If-Match` mismatch). */
  get isPreconditionFailed() {
    return this.status === 412;
  }

  get isForbidden() {
    return this.status === 403;
  }
}

/** Thrown when a background operation finishes with a Failure or Cancelled status. */
export class IncusOperationError extends IncusError {
  readonly operation: Operation;

  constructor(operation: Operation) {
    super(
      operation.err || `Operation ${operation.status.toLowerCase()}`,
      operation.status_code >= 400 ? operation.status_code : 500,
      operation.status_code,
      operation,
    );
    this.name = "IncusOperationError";
    this.operation = operation;
  }
}

/**
 * Minimal WebSocket surface used by the SDK. Satisfied by the browser
 * `WebSocket`, Node's global `WebSocket` and the `ws` package.
 */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * Opens a WebSocket to an Incus API path (e.g. `/1.0/events?type=lifecycle`).
 * The path already includes the query string.
 */
export type WebSocketConnector = (
  path: string,
) => WebSocketLike | Promise<WebSocketLike>;

export interface IncusClientOptions {
  /**
   * Incus API origin, e.g. `https://incus.example.com:8443`.
   * Leave empty in the browser to talk to the page's own origin.
   */
  url?: string;
  /** Default project for project-scoped requests. Omitted = server default (`default`). */
  project?: string;
  /** Default cluster member for requests that accept `?target=`. */
  target?: string;
  /** Bearer token (OIDC access token). */
  token?: string;
  /** Request timeout in ms. Default: no timeout (operations are awaited server-side). */
  timeout?: number;
  /**
   * Extra axios defaults: `httpsAgent` for mTLS, `socketPath` for the unix
   * socket, `withCredentials`, headers… See `@incendio/api/node` for helpers.
   */
  axios?: CreateAxiosDefaults;
  /** Use a pre-configured axios instance instead of creating one. */
  requester?: AxiosInstance;
  /** WebSocket factory for events, exec and console. Defaults to the global `WebSocket`. */
  websocket?: WebSocketConnector;
}

/** Per-request scope. Falls back to the client defaults. */
export interface ScopeOptions {
  project?: string;
  target?: string;
}

export interface ListOptions extends ScopeOptions {
  /** Server-side filter, e.g. `status eq Running` (see Incus REST API docs). */
  filter?: string;
  /** List across all projects (ignores `project`). */
  allProjects?: boolean;
}

export interface EtagOptions extends ScopeOptions {
  /** ETag from a previous GET; the update fails with 412 if the entity changed since. */
  etag?: string;
}

export interface WithEtag<T> {
  data: T;
  etag?: string;
}

/** Shared state handed to every endpoint class. */
export interface RequestContext {
  readonly r: AxiosInstance;
  readonly project?: string;
  readonly target?: string;
  readonly connect: WebSocketConnector;
}
