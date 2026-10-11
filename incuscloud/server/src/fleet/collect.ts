import type { IncusAdminClient } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";

export interface MemberSnapshot {
  name: string;
  url: string;
  status: string;
  roles: string[];
  architecture: string;
  cpuThreads: number;
  memoryTotal: number;
  memoryUsed: number;
  load1: number | null;
  uptimeS: number | null;
}

export interface InstanceSnapshot {
  project: string;
  name: string;
  type: string;
  status: string;
  location: string;
  description: string;
  architecture: string;
  createdAt: string;
  imageOs: string;
  imageRelease: string;
  limitsCpu: string;
  limitsMemory: string;
  cpuNs: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  diskUsed: number | null;
  netRx: number | null;
  netTx: number | null;
  addresses: string[];
}

export interface PoolSnapshot {
  member: string;
  name: string;
  driver: string;
  status: string;
  spaceTotal: number | null;
  spaceUsed: number | null;
}

export interface NetworkSnapshot {
  project: string;
  name: string;
  type: string;
  managed: boolean;
  status: string;
  description: string;
}

/** What one inventory pass read from a cluster. */
export interface Snapshot {
  clustered: boolean;
  members: MemberSnapshot[];
  instances: InstanceSnapshot[];
  pools: PoolSnapshot[];
  networks: NetworkSnapshot[];
}

type Client = Pick<IncusAdminClient, "request">;

// The parts of Incus's JSON read here (shared/api).
interface IncusInstance {
  name: string;
  project: string;
  type: string;
  status: string;
  location: string;
  description: string;
  architecture: string;
  created_at: string;
  expanded_config?: Record<string, string>;
  state?: {
    cpu?: { usage?: number };
    memory?: { usage?: number; total?: number };
    disk?: Record<string, { usage?: number }> | null;
    network?: Record<string, { type: string; counters?: { bytes_received?: number; bytes_sent?: number }; addresses?: Array<{ address: string }> }> | null;
  } | null;
}
interface IncusResources {
  cpu?: { total?: number; architecture?: string };
  memory?: { total?: number; used?: number };
}
interface IncusMemberState {
  sysinfo?: { uptime?: number; load_averages?: number[] };
  storage_pools?: Record<string, { space?: { total?: number; used?: number } }>;
}

const get = async <T>(c: Client, path: string): Promise<T> => (await c.request<T>("GET", path)).metadata;
/** Optional parts of the inventory: a failure leaves them unknown rather than failing the pass. */
const maybe = <T>(c: Client, path: string): Promise<T | undefined> => get<T>(c, path).catch(() => undefined);

const ACTIVE = new Set(["Running", "Frozen"]);
const linkLocal = (a: string) => /^fe[89ab][0-9a-f]:/i.test(a);

function instanceOf(i: IncusInstance): InstanceSnapshot {
  const cfg = i.expanded_config ?? {};
  const st = ACTIVE.has(i.status) ? i.state : null;
  const disks = Object.values(st?.disk ?? {})
    .map((d) => d.usage ?? -1)
    .filter((u) => u >= 0);
  const nics = Object.values(st?.network ?? {}).filter((n) => n.type !== "loopback");
  return {
    project: i.project,
    name: i.name,
    type: i.type,
    status: i.status,
    location: i.location ?? "",
    description: i.description ?? "",
    architecture: i.architecture ?? "",
    createdAt: i.created_at,
    imageOs: cfg["image.os"] ?? "",
    imageRelease: cfg["image.release"] ?? "",
    limitsCpu: cfg["limits.cpu"] ?? "",
    limitsMemory: cfg["limits.memory"] ?? "",
    cpuNs: st?.cpu?.usage ?? null,
    memoryUsed: st?.memory?.usage ?? null,
    memoryTotal: st?.memory?.total || null,
    diskUsed: disks.length ? disks.reduce((a, b) => a + b, 0) : null,
    netRx: st ? nics.reduce((a, n) => a + (n.counters?.bytes_received ?? 0), 0) : null,
    netTx: st ? nics.reduce((a, n) => a + (n.counters?.bytes_sent ?? 0), 0) : null,
    addresses: nics.flatMap((n) => (n.addresses ?? []).map((a) => a.address)).filter((a) => !linkLocal(a)),
  };
}

const memberOf = (base: Omit<MemberSnapshot, "cpuThreads" | "memoryTotal" | "memoryUsed" | "load1" | "uptimeS">, res?: IncusResources, state?: IncusMemberState): MemberSnapshot => ({
  ...base,
  architecture: base.architecture || res?.cpu?.architecture || "",
  cpuThreads: res?.cpu?.total ?? 0,
  memoryTotal: res?.memory?.total ?? 0,
  memoryUsed: res?.memory?.used ?? 0,
  load1: state?.sysinfo?.load_averages?.[0] ?? null,
  uptimeS: state?.sysinfo?.uptime ?? null,
});

/**
 * Reads a cluster's inventory with the admin client (D6). Members, pools and
 * networks are best effort; only the instance list is required.
 */
export async function collectInventory(c: Client): Promise<Snapshot> {
  const server = await get<{ environment: { server_clustered: boolean; server_name: string } }>(c, "/1.0");
  const clustered = !!server.environment.server_clustered;

  const raw = await get<IncusInstance[]>(c, "/1.0/instances?recursion=2&all-projects=true").catch((e) => {
    throw new ApiError(502, "cluster_error", `Reading instances: ${(e as Error).message}`);
  });
  const poolList = (await maybe<Array<{ name: string; driver: string; status: string }>>(c, "/1.0/storage-pools?recursion=1")) ?? [];
  const networks = ((await maybe<Array<NetworkSnapshot & { project?: string }>>(c, "/1.0/networks?recursion=1&all-projects=true")) ?? [])
    .filter((n) => n.managed)
    .map((n) => ({ project: n.project ?? "default", name: n.name, type: n.type, managed: n.managed, status: n.status ?? "", description: n.description ?? "" }));

  const members: MemberSnapshot[] = [];
  const pools: PoolSnapshot[] = [];
  if (clustered) {
    const list = (await maybe<Array<{ server_name: string; url: string; status: string; roles?: string[]; architecture?: string }>>(c, "/1.0/cluster/members?recursion=1")) ?? [];
    for (const m of list) {
      const name = encodeURIComponent(m.server_name);
      const [res, state] = await Promise.all([maybe<IncusResources>(c, `/1.0/resources?target=${name}`), maybe<IncusMemberState>(c, `/1.0/cluster/members/${name}/state`)]);
      members.push(memberOf({ name: m.server_name, url: m.url ?? "", status: m.status, roles: m.roles ?? [], architecture: m.architecture ?? "" }, res, state));
      for (const p of poolList) {
        const space = state?.storage_pools?.[p.name]?.space;
        if (space) pools.push({ member: m.server_name, name: p.name, driver: p.driver, status: p.status, spaceTotal: space.total ?? null, spaceUsed: space.used ?? null });
      }
    }
  } else {
    const name = server.environment.server_name;
    members.push(memberOf({ name, url: "", status: "Online", roles: [], architecture: "" }, await maybe<IncusResources>(c, "/1.0/resources")));
    for (const p of poolList) {
      const r = await maybe<{ space?: { total?: number; used?: number } }>(c, `/1.0/storage-pools/${encodeURIComponent(p.name)}/resources`);
      pools.push({ member: name, name: p.name, driver: p.driver, status: p.status, spaceTotal: r?.space?.total ?? null, spaceUsed: r?.space?.used ?? null });
    }
  }

  return { clustered, members, instances: raw.map(instanceOf), pools, networks };
}
