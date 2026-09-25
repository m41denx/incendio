import { Resource } from "./base/request";
import type {
  EtagOptions,
  ListOptions,
  RequestContext,
  ScopeOptions,
  WithEtag,
} from "./base/types";
import { Files } from "./files";
import { Backups } from "./backups";
import {
  InstanceLogs,
  InstanceMetadata,
  InstanceNvram,
  InstanceSnapshots,
} from "./instance_children";
import type {
  Access,
  Instance,
  InstanceBackup,
  InstanceBackupsPost,
  InstanceConsolePost,
  InstanceExecPost,
  InstanceFull,
  InstancePost,
  InstancePut,
  InstanceRebuildPost,
  InstanceState,
  InstanceStatePut,
  InstancesPost,
  InstanceType,
  Operation,
} from "./types/generated";
import type { DeepPartial, Input } from "../utils/types";
import { path } from "../utils/path";

export type InstanceAction =
  | "start"
  | "stop"
  | "restart"
  | "freeze"
  | "unfreeze";

export interface InstanceListOptions extends ListOptions {
  /** Only list containers or VMs. */
  type?: Exclude<InstanceType, "">;
}

export interface InstanceImportOptions extends ScopeOptions {
  /** New instance name (defaults to the name stored in the backup). */
  name?: string;
  /** Storage pool to restore into. */
  pool?: string;
}

/** `/1.0/instances` — collection-level instance operations. */
export class Instances extends Resource {
  private typeFilter(opts?: InstanceListOptions): ListOptions | undefined {
    if (!opts?.type) return opts;
    const type = `type eq ${opts.type}`;
    return {
      ...opts,
      filter: opts.filter ? `${opts.filter} and ${type}` : type,
    };
  }

  /** Lists instances (config only, no runtime state). */
  async list(opts?: InstanceListOptions): Promise<Instance[]> {
    return this.fetchList<Instance>(
      path("instances"),
      this.listScope(this.typeFilter(opts)),
    );
  }

  /** Lists instances with state, snapshots and backups (`recursion=2`). */
  async listFull(opts?: InstanceListOptions): Promise<InstanceFull[]> {
    return this.fetchList<InstanceFull>(
      path("instances"),
      this.listScope(this.typeFilter(opts)),
      2,
    );
  }

  async names(opts?: InstanceListOptions): Promise<string[]> {
    return this.fetchNames(
      path("instances"),
      this.listScope(this.typeFilter(opts)),
    );
  }

  /**
   * Creates an instance. `source.type` is `image`, `copy`, `migration` or
   * `none` (empty). Set `start: true` to boot it once created.
   */
  async create(
    body: Input<InstancesPost, "source">,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", path("instances"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Restores an instance from a backup tarball. */
  async importBackup(
    data: Blob | ArrayBuffer | ArrayBufferView | ReadableStream,
    opts: InstanceImportOptions = {},
  ): Promise<Operation> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (opts.name) headers["X-Incus-name"] = opts.name;
    if (opts.pool) headers["X-Incus-pool"] = opts.pool;
    return this.op("POST", path("instances"), {
      params: this.scope(opts),
      data,
      headers,
    });
  }

  /** Changes the state of all instances in the project (bulk start/stop/…). */
  async setStateAll(
    state: Input<InstanceStatePut, "action">,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("PUT", path("instances"), {
      params: this.scope(opts),
      data: { state },
    });
  }
}

/** `/1.0/instances/{name}` — one instance and its sub-resources. */
export class InstanceClient extends Resource {
  readonly name: string;
  readonly snapshots: InstanceSnapshots;
  readonly backups: Backups<InstanceBackup, Input<InstanceBackupsPost> | void>;
  readonly files: Files;
  readonly logs: InstanceLogs;
  readonly metadata: InstanceMetadata;
  readonly nvram: InstanceNvram;

  constructor(ctx: RequestContext, name: string) {
    super(ctx);
    this.name = name;
    this.snapshots = new InstanceSnapshots(ctx, name);
    this.backups = new Backups(ctx, ["instances", name]);
    this.files = new Files(ctx, this.url("files"));
    this.logs = new InstanceLogs(ctx, name);
    this.metadata = new InstanceMetadata(ctx, name);
    this.nvram = new InstanceNvram(ctx, name);
  }

  private url(...segments: string[]): string {
    return path("instances", this.name, ...segments);
  }

  async get(opts?: ScopeOptions): Promise<Instance> {
    return this.sync<Instance>("GET", this.url(), { params: this.scope(opts) });
  }

  /** Instance with state, snapshots and backups. */
  async getFull(opts?: ScopeOptions): Promise<InstanceFull> {
    return this.sync<InstanceFull>("GET", this.url(), {
      params: this.scope(opts, { recursion: 1 }),
    });
  }

  async getWithEtag(opts?: ScopeOptions): Promise<WithEtag<Instance>> {
    return this.syncEtag<Instance>(this.url(), { params: this.scope(opts) });
  }

  /** Replaces the instance configuration (PUT). */
  async update(body: InstancePut, opts?: EtagOptions): Promise<Operation> {
    return this.op("PUT", this.url(), this.etagOpts(opts, body));
  }

  /** Merges config/devices/profiles into the instance (PATCH). */
  async patch(
    body: DeepPartial<InstancePut>,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request("PATCH", this.url(), this.etagOpts(opts, body));
  }

  async delete(opts?: ScopeOptions): Promise<Operation> {
    return this.op("DELETE", this.url(), { params: this.scope(opts) });
  }

  async rename(newName: string, opts?: ScopeOptions): Promise<Operation> {
    return this.op("POST", this.url(), {
      params: this.scope(opts),
      data: { name: newName },
    });
  }

  /**
   * Moves the instance to another cluster member (`?target=`), storage pool
   * (`pool`) or project (`project`), or starts a migration to another server.
   */
  async migrate(
    body: Input<InstancePost>,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url(), {
      params: this.scope(opts),
      data: { migration: true, ...body },
    });
  }

  /** Runtime state: status, CPU, memory, disks, network, processes. */
  async state(opts?: ScopeOptions): Promise<InstanceState> {
    return this.sync<InstanceState>("GET", this.url("state"), {
      params: this.scope(opts),
    });
  }

  /** Changes the power state. */
  async setState(
    body: Input<InstanceStatePut, "action">,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("PUT", this.url("state"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Starts a command. See `InstanceExecPost` for websocket vs. recorded output modes. */
  async exec(
    body: Input<InstanceExecPost, "command">,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("exec"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Attaches to the console (`type: "console"` text or `"vga"` SPICE). */
  async console(
    body: Input<InstanceConsolePost> = {},
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("console"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** The console log buffer (containers) as text. */
  async consoleLog(opts?: ScopeOptions): Promise<string> {
    const { data } = await this.request<string>("GET", this.url("console"), {
      params: this.scope(opts),
      responseType: "text",
    });
    return data;
  }

  async clearConsoleLog(opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", this.url("console"), {
      params: this.scope(opts),
    });
  }

  /** PNG screenshot of a VM's VGA console (API extension: `instance_console_screenshot`). */
  async screenshot(opts?: ScopeOptions): Promise<ArrayBuffer> {
    const { data } = await this.request<ArrayBuffer>(
      "GET",
      this.url("console"),
      {
        params: this.scope(opts, { type: "vga" }),
        responseType: "arraybuffer",
      },
    );
    return data;
  }

  /** Who can access the instance (API extension: `instance_access`). */
  async access(opts?: ScopeOptions): Promise<Access> {
    return this.sync<Access>("GET", this.url("access"), {
      params: this.scope(opts),
    });
  }

  /** Rebuilds the root disk from a new image (or empty), keeping config. */
  async rebuild(
    body: Input<InstanceRebuildPost, "source">,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("rebuild"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Runs a repair action on the instance (API extension: `instance_debug_repair`). */
  async debugRepair(action: string, opts?: ScopeOptions): Promise<void> {
    await this.request("POST", this.url("debug", "repair"), {
      params: this.scope(opts),
      data: { action },
    });
  }
}
