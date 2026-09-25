import type { IncusClient } from "./Client";
import type { Profile as ProfileT } from "../api/types/generated";
import { applyConfig, type ConfigChanges } from "../utils/helpers";

/** Instance of a Humane Incus profile. */
export class Profile {
  private readonly client: IncusClient;
  private $data: ProfileT;

  constructor(client: IncusClient, data: ProfileT) {
    this.client = client;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get name() {
    return this.$data.name;
  }
  get description() {
    return this.$data.description;
  }
  get config() {
    return this.$data.config;
  }
  get devices() {
    return this.$data.devices;
  }
  /** URLs of the instances using this profile. */
  get usedBy() {
    return this.$data.used_by ?? [];
  }

  private get api() {
    return this.client.$api.profiles;
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.name);
    return this;
  }

  /** Edits the profile with optimistic locking (see `Instance.update`). */
  async update(
    mutate: (profile: ProfileT) => void | Promise<void>,
  ): Promise<void> {
    const { data, etag } = await this.api.getWithEtag(this.name);
    const draft = structuredClone(data);
    await mutate(draft);
    await this.api.update(this.name, draft, { etag });
    await this.refresh();
  }

  /** Sets config keys; `null` unsets a key. */
  setConfig(changes: ConfigChanges): Promise<void> {
    return this.update((p) => {
      p.config = applyConfig(p.config, changes);
    });
  }

  /** Adds/replaces a device, or removes it with `null`. */
  setDevice(
    name: string,
    device: Record<string, string> | null,
  ): Promise<void> {
    return this.update((p) => {
      const devices = { ...p.devices };
      if (device === null) delete devices[name];
      else devices[name] = device;
      p.devices = devices;
    });
  }

  async rename(newName: string): Promise<void> {
    await this.api.rename(this.name, newName);
    this.$data = { ...this.$data, name: newName };
  }

  delete(): Promise<void> {
    return this.api.delete(this.name);
  }
}
