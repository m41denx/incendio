import type { IncusClient } from "./Client";
import type { InstanceClient } from "../api/instances";
import type { Files, FileData, WriteFileOptions } from "../api/files";
import type {
  Access,
  DevicesMap,
  Instance as InstanceT,
  InstanceBackup as InstanceBackupT,
  InstanceBackupsPost,
  InstanceFull,
  InstancePost,
  InstanceSnapshot as InstanceSnapshotT,
  InstanceState,
  InstanceStatePut,
} from "../api/types/generated";
import { applyConfig, toDate, type ConfigChanges } from "../utils/helpers";
import type { Input } from "../utils/types";
import { nameFromUrl } from "../utils/path";
import { ExecSession } from "./ExecSession";
import { InstanceBackup } from "./InstanceBackup";
import { InstanceSnapshot } from "./InstanceSnapshot";
import type { OperationWaitOptions } from "./Operation";

export interface ExecOptions {
  /** Working directory inside the instance. */
  cwd?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** UID to run as. */
  user?: number;
  /** GID to run as. */
  group?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface StateChangeOptions extends OperationWaitOptions {
  /** Force the change (kill instead of clean shutdown). */
  force?: boolean;
  /** Seconds to wait for a clean shutdown before failing. */
  stopTimeout?: number;
  /** Save/restore the running state (stateful stop / start). */
  stateful?: boolean;
}

/**
 * Instance of a Humane Incus instance (container or VM).
 *
 * Actions await their background operation, and the local fields are
 * refreshed after each change.
 *
 * @example
 * const web = await client.getInstance("web");
 * if (!web.isRunning) await web.start();
 * const { stdout } = await web.exec(["uname", "-a"]);
 */
export class Instance {
  private readonly client: IncusClient;
  private $data: InstanceT;
  private $state: InstanceState | null;
  private $snapshots: InstanceSnapshotT[] | null;
  private $backups: InstanceBackupT[] | null;

  constructor(client: IncusClient, data: InstanceT | InstanceFull) {
    this.client = client;
    this.$data = data;
    const full = data as Partial<InstanceFull>;
    this.$state = full.state ?? null;
    this.$snapshots = full.snapshots ?? null;
    this.$backups = full.backups ?? null;
  }

  private $apiCache?: { key: string; api: InstanceClient };

  /** The raw API client for this instance. */
  get $api(): InstanceClient {
    const key = `${this.project}/${this.name}`;
    if (this.$apiCache?.key !== key) {
      this.$apiCache = {
        key,
        api: this.client.$api.withProject(this.project).instance(this.name),
      };
    }
    return this.$apiCache.api;
  }

  /** The raw API object. */
  get data(): InstanceT {
    return this.$data;
  }

  get name() {
    return this.$data.name;
  }
  get project(): string {
    return this.$data.project || this.client.project || "default";
  }
  get type() {
    return this.$data.type;
  }
  get isVM() {
    return this.$data.type === "virtual-machine";
  }
  get isContainer() {
    return this.$data.type === "container";
  }
  get description() {
    return this.$data.description;
  }
  get architecture() {
    return this.$data.architecture;
  }
  get status() {
    return this.$data.status;
  }
  get isRunning() {
    return this.$data.status === "Running";
  }
  get isStopped() {
    return this.$data.status === "Stopped";
  }
  get isFrozen() {
    return this.$data.status === "Frozen";
  }
  get ephemeral() {
    return this.$data.ephemeral;
  }
  get profiles() {
    return this.$data.profiles;
  }
  /** Instance-local config. See `expandedConfig` for the effective values. */
  get config() {
    return this.$data.config;
  }
  get devices() {
    return this.$data.devices;
  }
  /** Config with profiles applied. */
  get expandedConfig() {
    return this.$data.expanded_config ?? this.$data.config;
  }
  /** Devices with profiles applied. */
  get expandedDevices() {
    return this.$data.expanded_devices ?? this.$data.devices;
  }
  /** Cluster member the instance runs on. */
  get location() {
    return this.$data.location;
  }
  get createdAt() {
    return toDate(this.$data.created_at);
  }
  get lastUsedAt() {
    return toDate(this.$data.last_used_at);
  }
  /** Runtime state, when loaded (`getInstance` / `refresh({ full: true })` / `getState`). */
  get state(): InstanceState | null {
    return this.$state;
  }
  /** IPv4/IPv6 addresses from the loaded state, excluding loopback and link-local. */
  get addresses(): string[] {
    const networks = this.$state?.network ?? {};
    return Object.entries(networks)
      .filter(([iface]) => iface !== "lo")
      .flatMap(([, net]) => net.addresses ?? [])
      .filter((a) => a.scope === "global")
      .map((a) => a.address);
  }

  /** Reloads the instance (with state, snapshots and backups when `full`). */
  async refresh(opts: { full?: boolean } = { full: true }): Promise<this> {
    if (opts.full) {
      const full = await this.$api.getFull();
      this.$data = full;
      this.$state = full.state;
      this.$snapshots = full.snapshots ?? [];
      this.$backups = full.backups ?? [];
    } else {
      this.$data = await this.$api.get();
    }
    return this;
  }

  /** Fetches the current runtime state. */
  async getState(): Promise<InstanceState> {
    this.$state = await this.$api.state();
    this.$data = {
      ...this.$data,
      status: this.$state.status,
      status_code: this.$state.status_code,
    };
    return this.$state;
  }

  private async changeState(
    action: InstanceStatePut["action"],
    opts: StateChangeOptions = {},
  ): Promise<void> {
    const op = await this.$api.setState({
      action,
      force: opts.force,
      stateful: opts.stateful,
      timeout: opts.stopTimeout,
    });
    await this.client.operation(op).wait(opts);
    await this.refresh({ full: false });
  }

  start(opts?: StateChangeOptions) {
    return this.changeState("start", opts);
  }
  stop(opts?: StateChangeOptions) {
    return this.changeState("stop", opts);
  }
  restart(opts?: StateChangeOptions) {
    return this.changeState("restart", opts);
  }
  freeze(opts?: OperationWaitOptions) {
    return this.changeState("freeze", opts);
  }
  unfreeze(opts?: OperationWaitOptions) {
    return this.changeState("unfreeze", opts);
  }

  /**
   * Applies a change with optimistic locking: fetches the latest config,
   * lets `mutate` edit it, then PUTs it back with the ETag.
   *
   * @example
   * await vm.update((i) => {
   *   i.config["limits.cpu"] = "4";
   *   delete i.devices.eth1;
   * });
   */
  async update(
    mutate: (instance: InstanceT) => void | Promise<void>,
  ): Promise<void> {
    const { data, etag } = await this.$api.getWithEtag();
    const draft = structuredClone(data);
    await mutate(draft);
    await this.client.operation(await this.$api.update(draft, { etag })).wait();
    await this.refresh({ full: false });
  }

  /** Sets config keys; `null` unsets a key. */
  async setConfig(changes: ConfigChanges): Promise<void> {
    await this.update((i) => {
      i.config = applyConfig(i.config, changes);
    });
  }

  /** Adds/replaces a device, or removes it with `null`. */
  async setDevice(
    name: string,
    device: Record<string, string> | null,
  ): Promise<void> {
    await this.update((i) => {
      const devices: DevicesMap = { ...i.devices };
      if (device === null) delete devices[name];
      else devices[name] = device;
      i.devices = devices;
    });
  }

  async setProfiles(profiles: string[]): Promise<void> {
    await this.update((i) => {
      i.profiles = profiles;
    });
  }

  async setDescription(description: string): Promise<void> {
    await this.$api.patch({ description });
    this.$data = { ...this.$data, description };
  }

  async rename(newName: string, opts?: OperationWaitOptions): Promise<void> {
    await this.client.operation(await this.$api.rename(newName)).wait(opts);
    this.$data = { ...this.$data, name: newName };
  }

  /**
   * Moves the instance to another cluster member, pool or project
   * (stopped instances, or running ones with `live: true`).
   */
  async move(
    to: { target?: string; pool?: string; project?: string; live?: boolean },
    opts?: OperationWaitOptions,
  ): Promise<Instance> {
    const body: Input<InstancePost> = {
      name: this.name,
      migration: true,
      live: to.live ?? false,
      pool: to.pool,
      project: to.project,
    };
    const op = await this.$api.migrate(body, { target: to.target });
    await this.client.operation(op).wait(opts);
    return (
      to.project ? this.client.useProject(to.project) : this.client
    ).getInstance(this.name);
  }

  /** Copies the instance (optionally without snapshots) and returns the copy. */
  async copy(
    newName: string,
    opts: OperationWaitOptions & {
      instanceOnly?: boolean;
      target?: string;
      project?: string;
      start?: boolean;
    } = {},
  ): Promise<Instance> {
    const dest = opts.project
      ? this.client.useProject(opts.project)
      : this.client;
    const op = await dest.$api.instances.create(
      {
        name: newName,
        type: this.type,
        source: {
          type: "copy",
          source: this.name,
          project: this.project,
          instance_only: opts.instanceOnly ?? false,
        },
        start: opts.start,
      },
      { target: opts.target },
    );
    await this.client.operation(op).wait(opts);
    return dest.getInstance(newName);
  }

  /** Deletes the instance. `force` stops it first if running. */
  async delete(
    opts: OperationWaitOptions & { force?: boolean } = {},
  ): Promise<void> {
    if (opts.force && !this.isStopped) {
      await this.getState();
      if (!this.isStopped) await this.stop({ force: true });
    }
    await this.client.operation(await this.$api.delete()).wait(opts);
  }

  /**
   * Runs a command to completion and returns its output. Output is recorded
   * server-side (`record-output`), so no websocket is needed.
   */
  async exec(command: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const op = await this.$api.exec({
      command,
      environment: opts.env,
      cwd: opts.cwd,
      user: opts.user,
      group: opts.group,
      interactive: false,
      "wait-for-websocket": false,
      "record-output": true,
    });
    const done = await this.client.operation(op).wait();
    const output = (done.metadata?.output ?? {}) as Record<string, string>;
    const read = async (fd: string) => {
      if (!output[fd]) return "";
      const file = nameFromUrl(output[fd]);
      const text = await this.$api.logs.getExecOutput(file);
      await this.$api.logs.deleteExecOutput(file).catch(() => undefined);
      return text;
    };
    const [stdout, stderr] = await Promise.all([read("1"), read("2")]);
    return { exitCode: Number(done.metadata?.return ?? -1), stdout, stderr };
  }

  /**
   * Starts a command with live websocket streams — for terminals and for
   * feeding stdin. Needs a websocket connector (built in for browsers; see
   * `@incendio/api/node` for Node).
   */
  async execInteractive(
    command: string[],
    opts: ExecOptions & {
      interactive?: boolean;
      width?: number;
      height?: number;
    } = {},
  ): Promise<ExecSession> {
    const interactive = opts.interactive ?? true;
    const op = await this.$api.exec({
      command,
      environment: opts.env,
      cwd: opts.cwd,
      user: opts.user,
      group: opts.group,
      interactive,
      width: opts.width,
      height: opts.height,
      "wait-for-websocket": true,
    });
    return ExecSession.attach(this.client.$api, op, interactive, {
      project: this.project,
    });
  }

  /** File access inside the instance. */
  get files(): Files {
    return this.$api.files;
  }

  readFile(path: string): Promise<ArrayBuffer> {
    return this.files.read(path);
  }
  readTextFile(path: string): Promise<string> {
    return this.files.readText(path);
  }
  writeFile(
    path: string,
    data: FileData,
    opts?: WriteFileOptions,
  ): Promise<void> {
    return this.files.write(path, data, opts);
  }
  listDir(path: string): Promise<string[]> {
    return this.files.list(path);
  }
  deleteFile(path: string, opts?: { recursive?: boolean }): Promise<void> {
    return this.files.delete(path, opts);
  }

  /** Snapshots (cached from `getInstance`, or fetched). */
  async getSnapshots(
    opts: { refresh?: boolean } = {},
  ): Promise<InstanceSnapshot[]> {
    if (!this.$snapshots || opts.refresh) {
      this.$snapshots = await this.$api.snapshots.list();
    }
    return this.$snapshots.map((s) => new InstanceSnapshot(this, s));
  }

  async getSnapshot(name: string): Promise<InstanceSnapshot> {
    return new InstanceSnapshot(this, await this.$api.snapshots.get(name));
  }

  /** Takes a snapshot (auto-named when `name` is omitted). */
  async createSnapshot(
    name?: string,
    opts: OperationWaitOptions & { stateful?: boolean; expiresAt?: Date } = {},
  ): Promise<InstanceSnapshot> {
    const op = await this.$api.snapshots.create({
      name,
      stateful: opts.stateful ?? false,
      expires_at: opts.expiresAt?.toISOString(),
    });
    const done = await this.client.operation(op).wait(opts);
    const url = done.resources?.instances_snapshots?.[0];
    this.$snapshots = null;
    return this.getSnapshot(name ?? (url ? nameFromUrl(url) : ""));
  }

  async getBackups(
    opts: { refresh?: boolean } = {},
  ): Promise<InstanceBackup[]> {
    if (!this.$backups || opts.refresh) {
      this.$backups = await this.$api.backups.list();
    }
    return this.$backups.map((b) => new InstanceBackup(this, b));
  }

  /** Creates a backup (auto-named when `name` is omitted). */
  async createBackup(
    body: Input<InstanceBackupsPost> = {},
    opts?: OperationWaitOptions,
  ): Promise<InstanceBackup> {
    const done = await this.client
      .operation(await this.$api.backups.create(body))
      .wait(opts);
    const url = done.resources?.backups?.[0];
    this.$backups = null;
    const name = body.name ?? (url ? nameFromUrl(url) : "");
    return new InstanceBackup(this, await this.$api.backups.get(name));
  }

  /** Console log buffer (containers). */
  consoleLog(): Promise<string> {
    return this.$api.consoleLog();
  }

  /** PNG screenshot of the VGA console (VMs). */
  screenshot(): Promise<ArrayBuffer> {
    return this.$api.screenshot();
  }

  /** Who can access this instance. */
  access(): Promise<Access> {
    return this.$api.access();
  }

  /** @internal used by snapshots/backups to reach the operation helper */
  get $client(): IncusClient {
    return this.client;
  }
}
