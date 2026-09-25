import type { IncusClient } from "./Client";
import type { Image as ImageT } from "../api/types/generated";
import { toDate } from "../utils/helpers";
import type { OperationWaitOptions } from "./Operation";

/**
 * Instance of a Humane Incus image.
 *
 * @example
 * const image = await client.getImageByAlias("debian/12");
 * console.log(image.os, image.release, image.size);
 */
export class Image {
  private readonly client: IncusClient;
  private $data: ImageT;

  constructor(client: IncusClient, data: ImageT) {
    this.client = client;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get fingerprint() {
    return this.$data.fingerprint;
  }
  /** First 12 characters of the fingerprint, as shown by the CLI. */
  get shortFingerprint() {
    return this.$data.fingerprint.slice(0, 12);
  }
  get aliases(): string[] {
    return (this.$data.aliases ?? []).map((a) => a.name);
  }
  get type() {
    return this.$data.type;
  }
  get architecture() {
    return this.$data.architecture;
  }
  get properties(): Record<string, string> {
    return this.$data.properties ?? {};
  }
  get os() {
    return this.properties.os;
  }
  get release() {
    return this.properties.release;
  }
  get description() {
    return this.properties.description;
  }
  /** Size in bytes. */
  get size() {
    return this.$data.size;
  }
  get isPublic() {
    return this.$data.public;
  }
  get autoUpdate() {
    return this.$data.auto_update;
  }
  get cached() {
    return this.$data.cached;
  }
  get uploadedAt() {
    return toDate(this.$data.uploaded_at);
  }
  get expiresAt() {
    return toDate(this.$data.expires_at);
  }
  get lastUsedAt() {
    return toDate(this.$data.last_used_at);
  }

  private get api() {
    return this.client.$api.images;
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.fingerprint);
    return this;
  }

  /** Creates an alias pointing at this image. */
  async addAlias(name: string, description = ""): Promise<void> {
    await this.api.aliases.create({
      name,
      target: this.fingerprint,
      description,
    });
    await this.refresh();
  }

  async removeAlias(name: string): Promise<void> {
    await this.api.aliases.delete(name);
    await this.refresh();
  }

  async setPublic(isPublic: boolean): Promise<void> {
    await this.api.patch(this.fingerprint, { public: isPublic });
    await this.refresh();
  }

  async setAutoUpdate(autoUpdate: boolean): Promise<void> {
    await this.api.patch(this.fingerprint, { auto_update: autoUpdate });
    await this.refresh();
  }

  /** Re-downloads the image from its source if a newer version exists. */
  async refreshFromSource(opts?: OperationWaitOptions): Promise<void> {
    await this.client
      .operation(await this.api.refresh(this.fingerprint))
      .wait(opts);
  }

  /** Downloads the image file(s). */
  export(): Promise<ArrayBuffer> {
    return this.api.export(this.fingerprint);
  }

  async delete(opts?: OperationWaitOptions): Promise<void> {
    await this.client
      .operation(await this.api.delete(this.fingerprint))
      .wait(opts);
  }
}
