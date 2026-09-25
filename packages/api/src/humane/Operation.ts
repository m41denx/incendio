import type { IncusAPIClient } from "../api/client";
import { IncusOperationError } from "../api/base/types";
import type { Operation as OperationT } from "../api/types/generated";

export interface OperationWaitOptions {
  /** Give up after this many seconds (throws). Default: wait until done. */
  timeout?: number;
  /**
   * Called with the operation roughly every second while it runs — e.g. to
   * read `metadata.download_progress` or `metadata.create_instance_from_image_unpack_progress`.
   */
  onProgress?: (op: OperationT) => void;
}

/**
 * Instance of a Humane Incus background operation.
 *
 * @example
 * const op = client.operation(await client.$api.instance("web").setState({ action: "start" }));
 * await op.wait();
 */
export class IncusOperation {
  private readonly api: IncusAPIClient;
  private $data: OperationT;

  constructor(api: IncusAPIClient, data: OperationT) {
    this.api = api;
    this.$data = data;
  }

  get data(): OperationT {
    return this.$data;
  }
  get id() {
    return this.$data.id;
  }
  get description() {
    return this.$data.description;
  }
  get status() {
    return this.$data.status;
  }
  get metadata(): Record<string, unknown> {
    return this.$data.metadata ?? {};
  }
  /** Resource URLs affected by the operation, by kind (`instances`, …). */
  get resources(): Record<string, string[]> {
    return this.$data.resources ?? {};
  }
  get mayCancel() {
    return this.$data.may_cancel;
  }
  get isDone() {
    return ["Success", "Failure", "Cancelled"].includes(this.$data.status);
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.operations.get(this.id);
    return this;
  }

  async cancel(): Promise<void> {
    await this.api.operations.cancel(this.id);
  }

  /**
   * Waits for the operation to finish. Throws `IncusOperationError` if it
   * fails or is cancelled, or if `timeout` elapses first.
   */
  async wait(opts: OperationWaitOptions = {}): Promise<OperationT> {
    const deadline =
      opts.timeout !== undefined ? Date.now() + opts.timeout * 1000 : Infinity;
    if (opts.onProgress) {
      while (!this.isDone) {
        const remaining = (deadline - Date.now()) / 1000;
        if (remaining <= 0) break;
        this.$data = await this.api.operations.wait(this.id, {
          timeout: Math.min(1, remaining),
          throwOnFailure: false,
        });
        if (!this.isDone) opts.onProgress(this.$data);
      }
    } else if (!this.isDone) {
      this.$data = await this.api.operations.wait(this.id, {
        timeout: opts.timeout,
        throwOnFailure: false,
      });
    }
    if (!this.isDone) {
      throw new IncusOperationError({
        ...this.$data,
        err: `Timed out after ${opts.timeout}s waiting for operation ${this.id}`,
      });
    }
    if (this.$data.status !== "Success") {
      throw new IncusOperationError(this.$data);
    }
    return this.$data;
  }
}
