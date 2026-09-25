import { Resource } from "./base/request";
import type {
  EtagOptions,
  ListOptions,
  RequestContext,
  ScopeOptions,
  WithEtag,
} from "./base/types";
import type {
  ImageMetadata,
  InstanceNVRAMVariable,
  InstanceNVRAMVariablePut,
  InstanceSnapshot,
  InstanceSnapshotPost,
  InstanceSnapshotPut,
  InstanceSnapshotsPost,
  Operation,
} from "./types/generated";
import type { DeepPartial, Input } from "../utils/types";
import { path } from "../utils/path";

/** Base for endpoints below `/1.0/instances/{name}`. */
abstract class InstanceChild extends Resource {
  protected readonly instance: string;

  constructor(ctx: RequestContext, instance: string) {
    super(ctx);
    this.instance = instance;
  }

  protected url(...segments: string[]): string {
    return path("instances", this.instance, ...segments);
  }
}

/** `/1.0/instances/{name}/snapshots` */
export class InstanceSnapshots extends InstanceChild {
  async list(opts?: ListOptions): Promise<InstanceSnapshot[]> {
    return this.fetchList<InstanceSnapshot>(
      this.url("snapshots"),
      this.listScope(opts),
    );
  }

  async names(opts?: ListOptions): Promise<string[]> {
    return this.fetchNames(this.url("snapshots"), this.listScope(opts));
  }

  async get(name: string, opts?: ScopeOptions): Promise<InstanceSnapshot> {
    return this.sync<InstanceSnapshot>("GET", this.url("snapshots", name), {
      params: this.scope(opts),
    });
  }

  async getWithEtag(
    name: string,
    opts?: ScopeOptions,
  ): Promise<WithEtag<InstanceSnapshot>> {
    return this.syncEtag<InstanceSnapshot>(this.url("snapshots", name), {
      params: this.scope(opts),
    });
  }

  /** Creates a snapshot. `stateful` also saves the running state (VMs / CRIU). */
  async create(
    body: Input<InstanceSnapshotsPost>,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("snapshots"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Updates the snapshot (currently only `expires_at`). */
  async update(
    name: string,
    body: InstanceSnapshotPut,
    opts?: EtagOptions,
  ): Promise<Operation> {
    return this.op(
      "PUT",
      this.url("snapshots", name),
      this.etagOpts(opts, body),
    );
  }

  async patch(
    name: string,
    body: DeepPartial<InstanceSnapshotPut>,
    opts?: EtagOptions,
  ): Promise<Operation> {
    return this.op(
      "PATCH",
      this.url("snapshots", name),
      this.etagOpts(opts, body),
    );
  }

  async rename(
    name: string,
    newName: string,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("snapshots", name), {
      params: this.scope(opts),
      data: { name: newName },
    });
  }

  /** Migrates the snapshot (`migration: true`) — used for copies to other servers. */
  async migrate(
    name: string,
    body: Input<InstanceSnapshotPost>,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("snapshots", name), {
      params: this.scope(opts),
      data: body,
    });
  }

  async delete(name: string, opts?: ScopeOptions): Promise<Operation> {
    return this.op("DELETE", this.url("snapshots", name), {
      params: this.scope(opts),
    });
  }

  /**
   * Restores the instance to this snapshot.
   * @param stateful restore the saved running state too
   * @param diskOnly restore only the root disk (API extension: `instance_snapshot_disk_only_restore`)
   */
  async restore(
    name: string,
    opts?: ScopeOptions & { stateful?: boolean; diskOnly?: boolean },
  ): Promise<Operation> {
    return this.op("PUT", this.url(), {
      params: this.scope(opts),
      data: {
        restore: name,
        stateful: opts?.stateful ?? false,
        disk_only: opts?.diskOnly,
      },
    });
  }
}

/** `/1.0/instances/{name}/logs` (+ `exec-output`) */
export class InstanceLogs extends InstanceChild {
  /** Log file names. */
  async list(opts?: ScopeOptions): Promise<string[]> {
    return this.fetchNames(this.url("logs"), this.scope(opts));
  }

  async get(filename: string, opts?: ScopeOptions): Promise<string> {
    const { data } = await this.request<string>(
      "GET",
      this.url("logs", filename),
      {
        params: this.scope(opts),
        responseType: "text",
      },
    );
    return data;
  }

  async delete(filename: string, opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", this.url("logs", filename), {
      params: this.scope(opts),
    });
  }

  /** Recorded exec output files (`record-output: true`). */
  async listExecOutputs(opts?: ScopeOptions): Promise<string[]> {
    return this.fetchNames(this.url("logs", "exec-output"), this.scope(opts));
  }

  async getExecOutput(filename: string, opts?: ScopeOptions): Promise<string> {
    const { data } = await this.request<string>(
      "GET",
      this.url("logs", "exec-output", filename),
      { params: this.scope(opts), responseType: "text" },
    );
    return data;
  }

  async deleteExecOutput(filename: string, opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", this.url("logs", "exec-output", filename), {
      params: this.scope(opts),
    });
  }
}

/** `/1.0/instances/{name}/metadata` (+ `templates`) */
export class InstanceMetadata extends InstanceChild {
  async get(opts?: ScopeOptions): Promise<ImageMetadata> {
    return this.sync<ImageMetadata>("GET", this.url("metadata"), {
      params: this.scope(opts),
    });
  }

  async getWithEtag(opts?: ScopeOptions): Promise<WithEtag<ImageMetadata>> {
    return this.syncEtag<ImageMetadata>(this.url("metadata"), {
      params: this.scope(opts),
    });
  }

  async update(body: ImageMetadata, opts?: EtagOptions): Promise<void> {
    await this.request("PUT", this.url("metadata"), this.etagOpts(opts, body));
  }

  async patch(
    body: DeepPartial<ImageMetadata>,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request(
      "PATCH",
      this.url("metadata"),
      this.etagOpts(opts, body),
    );
  }

  /** Template file names. */
  async listTemplates(opts?: ScopeOptions): Promise<string[]> {
    return this.sync<string[]>("GET", this.url("metadata", "templates"), {
      params: this.scope(opts),
    });
  }

  async getTemplate(name: string, opts?: ScopeOptions): Promise<string> {
    const { data } = await this.request<string>(
      "GET",
      this.url("metadata", "templates"),
      { params: this.scope(opts, { path: name }), responseType: "text" },
    );
    return data;
  }

  async putTemplate(
    name: string,
    content: string,
    opts?: ScopeOptions,
  ): Promise<void> {
    await this.request("POST", this.url("metadata", "templates"), {
      params: this.scope(opts, { path: name }),
      data: content,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  async deleteTemplate(name: string, opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", this.url("metadata", "templates"), {
      params: this.scope(opts, { path: name }),
    });
  }
}

/** GUID → variable name → variable */
export type InstanceNVRAM = Record<
  string,
  Record<string, InstanceNVRAMVariable>
>;

/** `/1.0/instances/{name}/nvram` — UEFI variables (VMs, API extension: `instance_nvram`). */
export class InstanceNvram extends InstanceChild {
  async list(opts?: ScopeOptions): Promise<InstanceNVRAM> {
    return (
      (await this.sync<InstanceNVRAM>("GET", this.url("nvram"), {
        params: this.scope(opts, { recursion: 2 }),
      })) ?? {}
    );
  }

  /** Variables under one vendor GUID. */
  async listGuid(
    guid: string,
    opts?: ScopeOptions,
  ): Promise<Record<string, InstanceNVRAMVariable>> {
    return this.sync("GET", this.url("nvram", guid), {
      params: this.scope(opts, { recursion: 1 }),
    });
  }

  async get(
    guid: string,
    variable: string,
    opts?: ScopeOptions,
  ): Promise<InstanceNVRAMVariable> {
    return this.sync<InstanceNVRAMVariable>(
      "GET",
      this.url("nvram", guid, variable),
      { params: this.scope(opts) },
    );
  }

  async set(
    guid: string,
    variable: string,
    body: InstanceNVRAMVariablePut,
    opts?: ScopeOptions,
  ): Promise<void> {
    await this.request("PUT", this.url("nvram", guid, variable), {
      params: this.scope(opts),
      data: body,
    });
  }

  async patch(body: InstanceNVRAM, opts?: ScopeOptions): Promise<void> {
    await this.request("PATCH", this.url("nvram"), {
      params: this.scope(opts),
      data: body,
    });
  }

  async delete(
    guid: string,
    variable: string,
    opts?: ScopeOptions,
  ): Promise<void> {
    await this.request("DELETE", this.url("nvram", guid, variable), {
      params: this.scope(opts),
    });
  }
}
