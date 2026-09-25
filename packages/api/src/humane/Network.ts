import type { IncusClient } from "./Client";
import type {
  Network as NetworkT,
  NetworkLease,
  NetworkState,
} from "../api/types/generated";
import type { NetworkClient } from "../api/networks";
import { applyConfig, type ConfigChanges } from "../utils/helpers";

/** Instance of a Humane Incus network. */
export class Network {
  private readonly client: IncusClient;
  private $data: NetworkT;

  constructor(client: IncusClient, data: NetworkT) {
    this.client = client;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get name() {
    return this.$data.name;
  }
  /** `bridge`, `ovn`, `macvlan`, `sriov`, `physical`, or an unmanaged kind (`loopback`, …). */
  get type() {
    return this.$data.type;
  }
  get managed() {
    return this.$data.managed;
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

  /** Raw client for forwards, load balancers and peers of this network. */
  get $api(): NetworkClient {
    return this.client.$api.network(this.name);
  }

  private get api() {
    return this.client.$api.networks;
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.name);
    return this;
  }

  state(): Promise<NetworkState> {
    return this.$api.state();
  }

  leases(): Promise<NetworkLease[]> {
    return this.$api.leases();
  }

  async update(
    mutate: (network: NetworkT) => void | Promise<void>,
  ): Promise<void> {
    const { data, etag } = await this.api.getWithEtag(this.name);
    const draft = structuredClone(data);
    await mutate(draft);
    await this.api.update(this.name, draft, { etag });
    await this.refresh();
  }

  /** Sets config keys; `null` unsets a key. */
  setConfig(changes: ConfigChanges): Promise<void> {
    return this.update((n) => {
      n.config = applyConfig(n.config, changes);
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
