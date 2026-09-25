import type { IncusClient } from "./Client";
import type { Project as ProjectT, ProjectState } from "../api/types/generated";
import { applyConfig, type ConfigChanges } from "../utils/helpers";
import type { OperationWaitOptions } from "./Operation";

/** Instance of a Humane Incus project. */
export class Project {
  private readonly client: IncusClient;
  private $data: ProjectT;

  constructor(client: IncusClient, data: ProjectT) {
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
  get usedBy() {
    return this.$data.used_by ?? [];
  }
  /** Whether the project has its own images/profiles/networks/… (`features.*`). */
  hasFeature(
    feature:
      | "images"
      | "profiles"
      | "networks"
      | "networks.zones"
      | "storage.volumes"
      | "storage.buckets",
  ): boolean {
    return this.$data.config?.[`features.${feature}`] === "true";
  }

  private get api() {
    return this.client.$api.projects;
  }

  /** A client scoped to this project. */
  use(): IncusClient {
    return this.client.useProject(this.name);
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.name);
    return this;
  }

  /** Resource usage against the project limits. */
  state(): Promise<ProjectState> {
    return this.api.state(this.name);
  }

  async update(
    mutate: (project: ProjectT) => void | Promise<void>,
  ): Promise<void> {
    const { data, etag } = await this.api.getWithEtag(this.name);
    const draft = structuredClone(data);
    await mutate(draft);
    await this.api.update(this.name, draft, { etag });
    await this.refresh();
  }

  /** Sets config keys (`limits.*`, `restricted.*`, `features.*`); `null` unsets. */
  setConfig(changes: ConfigChanges): Promise<void> {
    return this.update((p) => {
      p.config = applyConfig(p.config, changes);
    });
  }

  async rename(newName: string, opts?: OperationWaitOptions): Promise<void> {
    await this.client
      .operation(await this.api.rename(this.name, newName))
      .wait(opts);
    this.$data = { ...this.$data, name: newName };
  }

  /** Deletes the project. `force` deletes everything in it as well. */
  delete(opts: { force?: boolean } = {}): Promise<void> {
    return this.api.delete(this.name, opts);
  }
}
