import type { OperationWaitOptions } from "./Operation";
import type { IncusClient } from "./Client";
import type { StorageVolumeType } from "../api/storage";
import type {
  ResourcesStoragePool,
  StoragePool as StoragePoolT,
} from "../api/types/generated";
import { applyConfig, formatSize, type ConfigChanges } from "../utils/helpers";

import { StorageVolume } from "./StorageVolume";

export interface CreateVolumeOptions extends OperationWaitOptions {
  /** e.g. `10GiB` or bytes. */
  size?: string | number;
  /** `filesystem` (default) or `block`. */
  contentType?: "filesystem" | "block" | "iso";
  description?: string;
  config?: Record<string, string>;
  /** Cluster member for local pools. */
  target?: string;
}

/**
 * Instance of a Humane Incus storage pool.
 *
 * @example
 * const pool = await client.getStoragePool("default");
 * const vol = await pool.createVolume("data", { size: "20GiB" });
 * await vol.attachTo("web", "/srv/data");
 */
export class StoragePool {
  private readonly client: IncusClient;
  private $data: StoragePoolT;

  constructor(client: IncusClient, data: StoragePoolT) {
    this.client = client;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get name() {
    return this.$data.name;
  }
  get driver() {
    return this.$data.driver;
  }
  get description() {
    return this.$data.description;
  }
  get config() {
    return this.$data.config;
  }
  get status() {
    return this.$data.status;
  }
  get usedBy() {
    return this.$data.used_by ?? [];
  }
  get locations() {
    return this.$data.locations ?? [];
  }

  /** Raw client for this pool's volumes and buckets. */
  get $api() {
    return this.client.$api.storagePool(this.name);
  }

  private get api() {
    return this.client.$api.storagePools;
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.name);
    return this;
  }

  /** Space and inode usage. */
  resources(): Promise<ResourcesStoragePool> {
    return this.api.resources(this.name);
  }

  /** Sets config keys; `null` unsets a key. */
  async setConfig(changes: ConfigChanges): Promise<void> {
    const { data, etag } = await this.api.getWithEtag(this.name);
    await this.api.update(
      this.name,
      {
        config: applyConfig(data.config, changes),
        description: data.description,
      },
      { etag },
    );
    await this.refresh();
  }

  delete(): Promise<void> {
    return this.api.delete(this.name);
  }

  /** Volumes in the pool (all types unless `type` is given). */
  async listVolumes(type?: StorageVolumeType): Promise<StorageVolume[]> {
    const volumes = await this.$api.volumes.list({ type });
    return volumes.map((v) => new StorageVolume(this.client, this.name, v));
  }

  async getVolume(
    name: string,
    type: StorageVolumeType = "custom",
  ): Promise<StorageVolume> {
    const data = await this.$api.volume(name, type).get();
    return new StorageVolume(this.client, this.name, data);
  }

  /** Creates a custom volume. */
  async createVolume(
    name: string,
    opts: CreateVolumeOptions = {},
  ): Promise<StorageVolume> {
    const config = { ...opts.config };
    if (opts.size !== undefined) {
      config.size =
        typeof opts.size === "number" ? formatSize(opts.size) : opts.size;
    }
    const op = await this.$api.volumes.create(
      {
        name,
        type: "custom",
        content_type: opts.contentType ?? "filesystem",
        description: opts.description ?? "",
        config,
      },
      { target: opts.target },
    );
    if (op) await this.client.operation(op).wait(opts);
    return this.getVolume(name);
  }
}
