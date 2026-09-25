import type { IncusClient } from "./Client";
import type { StorageVolumeClient, StorageVolumeType } from "../api/storage";
import type { Files } from "../api/files";
import type {
  StorageVolume as StorageVolumeT,
  StorageVolumeSnapshot as StorageVolumeSnapshotT,
  StorageVolumeState,
} from "../api/types/generated";
import {
  applyConfig,
  formatSize,
  parseSize,
  toDate,
  type ConfigChanges,
} from "../utils/helpers";
import type { OperationWaitOptions } from "./Operation";

export interface VolumeSnapshot {
  /** Snapshot name without the `volume/` prefix. */
  name: string;
  description: string;
  config: Record<string, string>;
  contentType: string;
  createdAt: Date | null;
  expiresAt: Date | null;
  /** The raw API object. */
  data: StorageVolumeSnapshotT;
}

/** Instance of a Humane Incus storage volume. */
export class StorageVolume {
  private readonly client: IncusClient;
  readonly pool: string;
  private $data: StorageVolumeT;

  constructor(client: IncusClient, pool: string, data: StorageVolumeT) {
    this.client = client;
    this.pool = pool;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get name() {
    return this.$data.name;
  }
  get type() {
    return this.$data.type as StorageVolumeType;
  }
  get contentType() {
    return this.$data.content_type;
  }
  get project(): string {
    return this.$data.project || this.client.project || "default";
  }
  get description() {
    return this.$data.description;
  }
  get config() {
    return this.$data.config;
  }
  /** Configured size (`size` key) in bytes, or null when unlimited. */
  get size(): number | null {
    return this.$data.config?.size ? parseSize(this.$data.config.size) : null;
  }
  get usedBy() {
    return this.$data.used_by ?? [];
  }
  get location() {
    return this.$data.location;
  }
  get createdAt() {
    return toDate(this.$data.created_at);
  }

  /** Raw client for this volume. */
  get $api(): StorageVolumeClient {
    return this.client.$api
      .withProject(this.project)
      .storagePool(this.pool)
      .volume(this.name, this.type);
  }

  /** Files of a filesystem custom volume. */
  get files(): Files {
    return this.$api.files;
  }

  async refresh(): Promise<this> {
    this.$data = await this.$api.get();
    return this;
  }

  /** Current usage. */
  state(): Promise<StorageVolumeState> {
    return this.$api.state();
  }

  /** Sets config keys; `null` unsets a key. */
  async setConfig(changes: ConfigChanges): Promise<void> {
    const { data, etag } = await this.$api.getWithEtag();
    await this.$api.update(
      {
        config: applyConfig(data.config, changes),
        description: data.description,
      },
      { etag },
    );
    await this.refresh();
  }

  /** Grows (or shrinks, if the driver allows) the volume. */
  resize(size: string | number): Promise<void> {
    return this.setConfig({
      size: typeof size === "number" ? formatSize(size) : size,
    });
  }

  /** Attaches the volume to an instance as a disk device. */
  async attachTo(
    instance: string,
    mountPath?: string,
    deviceName = this.name,
  ): Promise<void> {
    const target = await this.client
      .useProject(this.project)
      .getInstance(instance);
    const device: Record<string, string> = {
      type: "disk",
      pool: this.pool,
      source: this.name,
    };
    if (mountPath) device.path = mountPath;
    await target.setDevice(deviceName, device);
  }

  async rename(newName: string, opts?: OperationWaitOptions): Promise<void> {
    const op = await this.$api.rename(newName);
    if (op) await this.client.operation(op).wait(opts);
    this.$data = { ...this.$data, name: newName };
  }

  delete(): Promise<void> {
    return this.$api.delete();
  }

  /** Snapshots of the volume, with `name` relative to the volume (`snap0`, not `data/snap0`). */
  async listSnapshots(): Promise<VolumeSnapshot[]> {
    const snapshots = await this.$api.snapshots.list();
    return snapshots.map((s) => ({
      name: s.name.split("/").pop()!,
      description: s.description,
      config: s.config,
      contentType: s.content_type,
      createdAt: toDate(s.created_at),
      expiresAt: toDate(s.expires_at),
      data: s,
    }));
  }

  /** Takes a snapshot (auto-named when `name` is omitted). */
  async createSnapshot(
    name?: string,
    opts: OperationWaitOptions & { expiresAt?: Date } = {},
  ): Promise<void> {
    const op = await this.$api.snapshots.create({
      name,
      expires_at: opts.expiresAt?.toISOString(),
    });
    await this.client.operation(op).wait(opts);
  }

  /** Restores the volume to a snapshot. */
  async restoreSnapshot(name: string): Promise<void> {
    await this.$api.snapshots.restore(name);
  }

  async deleteSnapshot(
    name: string,
    opts?: OperationWaitOptions,
  ): Promise<void> {
    await this.client
      .operation(await this.$api.snapshots.delete(name))
      .wait(opts);
  }
}
