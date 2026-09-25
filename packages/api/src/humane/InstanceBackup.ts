import type { InstanceBackup as InstanceBackupT } from "../api/types/generated";
import { toDate } from "../utils/helpers";
import type { OperationWaitOptions } from "./Operation";
import type { Instance } from "./Instance";

/** Instance of a Humane Incus instance backup. */
export class InstanceBackup {
  readonly instance: Instance;
  private readonly $data: InstanceBackupT;

  constructor(instance: Instance, data: InstanceBackupT) {
    this.instance = instance;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
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
  get instanceOnly() {
    return this.$data.instance_only;
  }
  get optimizedStorage() {
    return this.$data.optimized_storage;
  }

  private get api() {
    return this.instance.$api.backups;
  }

  /** Downloads the tarball into memory. */
  download(): Promise<ArrayBuffer> {
    return this.api.export(this.name);
  }

  /** Download URL relative to the API origin (for `<a href>` in browsers). */
  get downloadUrl(): string {
    return this.api.exportUrl(this.name, { project: this.instance.project });
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
}
