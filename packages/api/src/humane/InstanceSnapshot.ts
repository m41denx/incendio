import type { InstanceSnapshot as InstanceSnapshotT } from "../api/types/generated";
import { toDate } from "../utils/helpers";
import type { OperationWaitOptions } from "./Operation";
import type { Instance } from "./Instance";

/** Instance of a Humane Incus instance snapshot. */
export class InstanceSnapshot {
  readonly instance: Instance;
  private readonly $data: InstanceSnapshotT;

  constructor(instance: Instance, data: InstanceSnapshotT) {
    this.instance = instance;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  /** Snapshot name (without the `instance/` prefix). */
  get name() {
    return this.$data.name.includes("/")
      ? this.$data.name.split("/").pop()!
      : this.$data.name;
  }
  get createdAt() {
    return toDate(this.$data.created_at);
  }
  get expiresAt() {
    return toDate(this.$data.expires_at);
  }
  get stateful() {
    return this.$data.stateful;
  }
  /** Size in bytes (-1 if unknown). */
  get size() {
    return this.$data.size;
  }
  get config() {
    return this.$data.config;
  }

  private get api() {
    return this.instance.$api.snapshots;
  }

  /** Restores the instance to this snapshot. */
  async restore(
    opts: OperationWaitOptions & {
      stateful?: boolean;
      diskOnly?: boolean;
    } = {},
  ): Promise<void> {
    await this.instance.$client
      .operation(await this.api.restore(this.name, opts))
      .wait(opts);
    await this.instance.refresh({ full: false });
  }

  async rename(newName: string, opts?: OperationWaitOptions): Promise<void> {
    await this.instance.$client
      .operation(await this.api.rename(this.name, newName))
      .wait(opts);
  }

  async delete(opts?: OperationWaitOptions): Promise<void> {
    await this.instance.$client
      .operation(await this.api.delete(this.name))
      .wait(opts);
  }

  /** Sets (or with `null` clears) the expiry date. */
  async setExpiry(
    expiresAt: Date | null,
    opts?: OperationWaitOptions,
  ): Promise<void> {
    const op = await this.api.update(this.name, {
      expires_at: expiresAt ? expiresAt.toISOString() : "0001-01-01T00:00:00Z",
    });
    await this.instance.$client.operation(op).wait(opts);
  }

  /** Creates a new instance from this snapshot. */
  async copyTo(
    newName: string,
    opts?: OperationWaitOptions,
  ): Promise<Instance> {
    const client = this.instance.$client;
    const op = await client.$api
      .withProject(this.instance.project)
      .instances.create({
        name: newName,
        type: this.instance.type,
        source: { type: "copy", source: `${this.instance.name}/${this.name}` },
      });
    await client.operation(op).wait(opts);
    return client.useProject(this.instance.project).getInstance(newName);
  }
}
