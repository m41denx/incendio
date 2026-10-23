/** The source instance as Incus reports it (`GET /1.0/instances/<name>`), plus its snapshot count. */
export interface SourceInstance {
  name: string;
  type: "container" | "virtual-machine";
  status: string;
  architecture: string;
  /** Local config (not expanded): what the target instance is created with. */
  config: Record<string, string>;
  /** Expanded config, for checks that profiles may satisfy. */
  expandedConfig?: Record<string, string>;
  devices: Record<string, Record<string, string>>;
  profiles: string[];
  expandedDevices: Record<string, Record<string, string>>;
  snapshots: number;
  apiExtensions: string[];
}

/** What the target cluster and project offer. */
export interface TargetFacts {
  projectExists: boolean;
  architectures: string[];
  pools: string[];
  networks: string[];
  profiles: string[];
  instanceNames: string[];
  defaultProfileDevices: Record<string, Record<string, string>>;
  apiExtensions: string[];
}

export interface PreflightInput {
  source: SourceInstance;
  target: TargetFacts;
  targetName: string;
  mode: "copy" | "move";
  live: boolean;
  /** The target storage pool; by default the target default profile's, or the only one. */
  pool?: string;
}

export interface TargetRequest {
  name: string;
  type: string;
  architecture: string;
  config: Record<string, string>;
  devices: Record<string, Record<string, string>>;
  profiles: string[];
}

export interface Preflight {
  ok: boolean;
  /** Each one blocks the migration. */
  problems: string[];
  /** Worth knowing; nothing blocks. */
  warnings: string[];
  /** The target's `POST /1.0/instances` body, without `source`. */
  request: TargetRequest;
}

const rootOf = (devices: Record<string, Record<string, string>>) => Object.entries(devices).find(([, d]) => d.type === "disk" && d.path === "/");

/** Checks whether an instance can go to the target, and builds the target request. Pure. */
export function preflight(i: PreflightInput): Preflight {
  const { source: s, target: t } = i;
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!t.projectExists) problems.push("The target project does not exist");
  if (t.instanceNames.includes(i.targetName)) problems.push(`An instance named "${i.targetName}" already exists on the target`);
  if (t.architectures.length && !t.architectures.includes(s.architecture)) problems.push(`The target has no ${s.architecture} members`);
  for (const p of s.profiles) if (!t.profiles.includes(p)) problems.push(`Profile "${p}" does not exist on the target`);

  // The root disk goes to the chosen pool, as a local device so the choice holds whatever the profiles say.
  let pool = i.pool;
  if (pool && !t.pools.includes(pool)) {
    problems.push(`Storage pool "${pool}" does not exist on the target`);
  } else if (!pool) {
    const profilePool = rootOf(t.defaultProfileDevices)?.[1].pool;
    pool = profilePool && t.pools.includes(profilePool) ? profilePool : t.pools.length === 1 ? t.pools[0] : undefined;
    if (!pool) problems.push("Choose a storage pool on the target");
  }

  const devices: Record<string, Record<string, string>> = {};
  const root = rootOf(s.expandedDevices);
  if (root && pool) devices[root[0]] = { ...root[1], pool };

  for (const [name, d] of Object.entries(s.expandedDevices)) {
    if (root && name === root[0]) continue;
    const local = name in s.devices;
    if (d.type === "nic") {
      if (!local) {
        if (s.profiles.includes("default") && !(name in t.defaultProfileDevices)) warnings.push(`The target's default profile has no "${name}": the instance will have no such NIC there`);
        continue;
      }
      if (d.network && !t.networks.includes(d.network)) problems.push(`Network "${d.network}" (${name}) does not exist on the target`);
      else if (!d.network) warnings.push(`${name} (nic) is copied as is`);
      devices[name] = d;
      continue;
    }
    if (!local) continue; // profiles on the target supply their own devices
    if (d.type === "disk" && d.pool && d.source) {
      problems.push(`Volume "${d.source}" (${name}) is not migrated; detach it first`);
    } else if (d.type === "disk" && d.source?.startsWith("/")) {
      warnings.push(`Host path "${d.source}" (${name}) must exist on the target`);
      devices[name] = d;
    } else if (d.type !== "none") {
      if (d.type !== "disk") warnings.push(`${name} (${d.type}) is copied as is`);
      devices[name] = d;
    } else {
      devices[name] = d;
    }
  }

  if (i.live) {
    const cfg = s.expandedConfig ?? s.config;
    if (s.type === "container") problems.push("Containers cannot move live");
    else {
      if (s.status !== "Running") problems.push("Only a running instance moves live");
      if (cfg["migration.stateful"] !== "true") problems.push("Live moves need migration.stateful=true on the instance");
      if (!s.apiExtensions.includes("migration_vm_live")) problems.push("The source does not support live VM migration");
      if (!t.apiExtensions.includes("migration_vm_live")) problems.push("The target does not support live VM migration");
    }
  } else if (s.status === "Running") {
    if (i.mode === "move") warnings.push(`The ${s.type === "container" ? "container" : "instance"} is stopped for the move and started again on the target`);
    else warnings.push("The copy is not started");
  }
  if (s.snapshots > 0) warnings.push(`${s.snapshots} snapshot${s.snapshots === 1 ? " is" : "s are"} copied too`);

  // A move keeps the instance's identity (UUID, MAC addresses, vsock id), as `incus move` does: a VM
  // restored live needs it, or QEMU refuses the saved device state. A copy is a new instance.
  const keep = (k: string) => k !== "volatile.last_state.power" && (i.mode === "move" || !k.startsWith("volatile.") || k === "volatile.base_image");
  const config = Object.fromEntries(Object.entries(s.config).filter(([k]) => keep(k)));
  return {
    ok: problems.length === 0,
    problems,
    warnings,
    request: { name: i.targetName, type: s.type, architecture: s.architecture, config, devices, profiles: s.profiles },
  };
}
