import type { IncusClient } from "./Client";
import type {
  ClusterMember as ClusterMemberT,
  ClusterMemberState,
} from "../api/types/generated";
import type { OperationWaitOptions } from "./Operation";

/** Instance of a Humane Incus cluster member. */
export class ClusterMember {
  private readonly client: IncusClient;
  private $data: ClusterMemberT;

  constructor(client: IncusClient, data: ClusterMemberT) {
    this.client = client;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get name() {
    return this.$data.server_name;
  }
  get url() {
    return this.$data.url;
  }
  /** `Online`, `Offline`, `Evacuated`, `Blocked`, … */
  get status() {
    return this.$data.status;
  }
  get message() {
    return this.$data.message;
  }
  get isOnline() {
    return this.$data.status === "Online";
  }
  get isEvacuated() {
    return this.$data.status === "Evacuated";
  }
  get isDatabase() {
    return this.$data.database;
  }
  get roles() {
    return this.$data.roles ?? [];
  }
  get architecture() {
    return this.$data.architecture;
  }
  get failureDomain() {
    return this.$data.failure_domain;
  }
  get description() {
    return this.$data.description;
  }
  get config() {
    return this.$data.config;
  }
  get groups() {
    return this.$data.groups ?? [];
  }

  private get api() {
    return this.client.$api.cluster.members;
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.name);
    return this;
  }

  /** Storage pool usage and system info of the member. */
  state(): Promise<ClusterMemberState> {
    return this.api.state(this.name);
  }

  /** Moves or stops the member's instances so it can be taken down. */
  async evacuate(
    mode?: "auto" | "stop" | "migrate" | "live-migrate",
    opts?: OperationWaitOptions,
  ): Promise<void> {
    await this.client
      .operation(await this.api.setState(this.name, "evacuate", mode))
      .wait(opts);
    await this.refresh();
  }

  /** Brings an evacuated member back and restarts/returns its instances. */
  async restore(opts?: OperationWaitOptions): Promise<void> {
    await this.client
      .operation(await this.api.setState(this.name, "restore"))
      .wait(opts);
    await this.refresh();
  }

  async rename(newName: string): Promise<void> {
    await this.api.rename(this.name, newName);
    this.$data = { ...this.$data, server_name: newName };
  }

  /** Removes the member from the cluster. */
  remove(opts: { force?: boolean } = {}): Promise<void> {
    return this.api.delete(this.name, opts);
  }
}
