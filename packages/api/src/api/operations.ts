import { Resource } from "./base/request";
import {
  IncusOperationError,
  type ListOptions,
  type ScopeOptions,
  type WebSocketLike,
} from "./base/types";
import type { Operation } from "./types/generated";
import { operationId, path } from "../utils/path";

export interface OperationList {
  running?: Operation[];
  success?: Operation[];
  failure?: Operation[];
}

export interface WaitOptions extends ScopeOptions {
  /**
   * Seconds to wait. The call resolves with the operation still running if
   * it hasn't finished by then. Default: wait until done.
   */
  timeout?: number;
  /** Throw `IncusOperationError` when the operation fails (default `true`). */
  throwOnFailure?: boolean;
}

/** Seconds per long-poll when waiting without a timeout. */
const WAIT_CHUNK = 30;

const isFinal = (op: Operation) =>
  op.status === "Success" ||
  op.status === "Failure" ||
  op.status === "Cancelled";

/** `/1.0/operations` — background tasks, their state and websockets. */
export class Operations extends Resource {
  /** Operations grouped by status. */
  async list(opts?: ListOptions): Promise<OperationList> {
    return (
      (await this.sync<OperationList>("GET", path("operations"), {
        params: this.listScope(opts, { recursion: 1 }),
      })) ?? {}
    );
  }

  /** All operations as a flat array. */
  async listAll(opts?: ListOptions): Promise<Operation[]> {
    const grouped = await this.list(opts);
    return Object.values(grouped).flat() as Operation[];
  }

  async get(id: string, opts?: ScopeOptions): Promise<Operation> {
    return this.sync<Operation>("GET", path("operations", operationId(id)), {
      params: this.scope(opts),
    });
  }

  /** Cancels a running operation (if `may_cancel`). */
  async cancel(id: string, opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", path("operations", operationId(id)), {
      params: this.scope(opts),
    });
  }

  /**
   * Waits for an operation to finish (server-side long-poll) and returns its
   * final state. Accepts the operation object, its id or its URL.
   */
  async wait(
    op: Operation | string,
    opts: WaitOptions = {},
  ): Promise<Operation> {
    const id = typeof op === "string" ? operationId(op) : op.id;
    const deadline =
      opts.timeout !== undefined ? Date.now() + opts.timeout * 1000 : Infinity;
    let current: Operation;
    for (;;) {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      const timeout = Math.max(0, Math.min(WAIT_CHUNK, remaining));
      current = await this.sync<Operation>(
        "GET",
        `${path("operations", id)}/wait`,
        { params: this.scope(opts, { timeout }) },
      );
      if (isFinal(current) || Date.now() >= deadline) break;
    }
    if (
      opts.throwOnFailure !== false &&
      (current.status === "Failure" || current.status === "Cancelled")
    ) {
      throw new IncusOperationError(current);
    }
    return current;
  }

  /**
   * Opens one of a websocket operation's streams (exec/console fds or
   * `control`) using the secret from `operation.metadata.fds`.
   */
  async websocket(
    id: string,
    secret: string,
    opts?: ScopeOptions,
  ): Promise<WebSocketLike> {
    const params = new URLSearchParams({ secret });
    const project = opts?.project ?? this.ctx.project;
    if (project) params.set("project", project);
    return this.ctx.connect(
      `${path("operations", operationId(id))}/websocket?${params}`,
    );
  }
}
