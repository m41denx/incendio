import type { IncusAdminClient } from "../incus/admin-client.ts";
import { ClusterError } from "../incus/admin-client.ts";
import type { Quotas } from "../db/schema.ts";
import type { Limits, Usage } from "../tenants/quota.ts";
import { ApiError } from "../lib/errors.ts";

export const TENANT_KEY = "user.incuscloud.tenant";

/** Restricted tenant project (spec D5): own images, profiles and volumes, the cluster's networks, and this placement's share of the quota. */
export function projectConfigFor(tenant: { id: string }, limits: Limits): Record<string, string> {
  return {
    restricted: "true",
    // Restricted projects block backups by default, the control plane's included (P7).
    "restricted.backups": "allow",
    // Kubernetes nodes (P10) are unprivileged containers that need nesting; they stay unprivileged.
    "restricted.containers.nesting": "allow",
    // Tenants see their clusters' members and may create on a chosen one (the console's target picker).
    "restricted.cluster.target": "allow",
    "features.images": "true",
    "features.profiles": "true",
    "features.storage.volumes": "true",
    "features.storage.buckets": "true",
    "features.networks": "false",
    [TENANT_KEY]: tenant.id,
    // Counts, CPUs and bytes: Incus takes a plain number of bytes for memory and disk.
    ...Object.fromEntries(Object.entries(limits).map(([k, v]) => [`limits.${k}`, String(v)])),
  };
}

// Kept in line with projectConfigFor on existing projects; features.* cannot change once a project has content.
const UPDATABLE = (k: string) => k.startsWith("restricted") || k.startsWith("limits.") || k === TENANT_KEY;

/** Creates the tenant's project, or brings its limits in line. Refuses a same-named project that is not this tenant's. */
export async function ensureProject(client: IncusAdminClient, name: string, tenant: { id: string; slug: string }, limits: Limits, clusterGroups: string[] = []): Promise<"created" | "updated" | "unchanged"> {
  const want = projectConfigFor(tenant, limits);
  // Permissions: a tenant whose default group is given only cluster groups here runs on those groups' members.
  if (clusterGroups.length) want["restricted.cluster.groups"] = [...clusterGroups].sort().join(",");
  let current: Record<string, string>;
  let description: string;
  try {
    const project = (await client.request<{ config: Record<string, string>; description: string }>("GET", `/1.0/projects/${encodeURIComponent(name)}`)).metadata;
    current = project.config ?? {};
    description = project.description ?? "";
  } catch (e) {
    if (!(e instanceof ClusterError && e.clusterStatus === 404)) throw e;
    await client.request("POST", "/1.0/projects", { name, description: `IncusCloud tenant ${tenant.slug}`, config: want });
    return "created";
  }
  if (current[TENANT_KEY] !== tenant.id) {
    throw new ApiError(409, "project_exists", `Project "${name}" already exists on the cluster and does not belong to this tenant`);
  }
  const patch: Record<string, string> = {};
  for (const k of Object.keys(want)) if (UPDATABLE(k) && current[k] !== want[k]) patch[k] = want[k]!;
  // Quotas removed since: unset their limits.
  for (const k of Object.keys(current)) if ((k.startsWith("limits.") || k === "restricted.cluster.groups") && !(k in want)) patch[k] = "";
  if (!Object.keys(patch).length) return "unchanged";
  // The whole config, never a PATCH: Incus (7.5, and main as of 2026-10) applies a project PATCH's
  // config as the complete config, so a PATCH of the limits alone would drop `restricted` and the rest.
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === "") delete next[k];
    else next[k] = v;
  }
  await client.request("PUT", `/1.0/projects/${encodeURIComponent(name)}`, { config: next, description });
  return "updated";
}

/** What the project uses as Incus counts it for limits.*; null when it does not exist yet. */
export async function projectUsage(client: Pick<IncusAdminClient, "request">, name: string): Promise<Usage | null> {
  try {
    const r = (await client.request<{ resources: Record<string, { Usage: number }> }>("GET", `/1.0/projects/${encodeURIComponent(name)}/state`)).metadata.resources;
    return { instances: r.instances?.Usage ?? 0, cpu: r.cpu?.Usage ?? 0, memory: r.memory?.Usage ?? 0, disk: r.disk?.Usage ?? 0 };
  } catch (e) {
    if (e instanceof ClusterError && e.clusterStatus === 404) return null;
    throw e;
  }
}

type Devices = Record<string, Record<string, string>>;
const rootOf = (d: Devices) => Object.entries(d).find(([, v]) => v.type === "disk" && v.path === "/");
const nicOf = (d: Devices) => Object.entries(d).find(([, v]) => v.type === "nic");

// Per-instance defaults when the project has the matching quota: Incus then
// refuses instances without their own limits.cpu / limits.memory / root size.
const DEFAULT_CPU = 1;
const DEFAULT_MEMORY_GIB = 1;
const DEFAULT_DISK_GIB = 10;

/**
 * Makes the project's default profile usable: a root disk and a NIC when it lacks them, and the
 * per-instance limits its quotas require. Only missing values are filled; the tenant owns the rest.
 */
export async function ensureDefaultProfile(client: IncusAdminClient, project: string, quotas: Quotas = {}): Promise<void> {
  const q = `?project=${encodeURIComponent(project)}`;
  const profile = (await client.request<{ config: Record<string, string>; devices: Devices; description?: string }>("GET", `/1.0/profiles/default${q}`)).metadata;
  const devices: Devices = { ...profile.devices };
  const config: Record<string, string> = { ...profile.config };
  let changed = false;
  if (!rootOf(devices) || !nicOf(devices)) {
    const source = (await client.request<{ devices: Devices }>("GET", "/1.0/profiles/default?project=default")).metadata.devices ?? {};
    if (!rootOf(devices)) {
      const root = rootOf(source);
      if (root) devices[root[0]] = { ...root[1] };
      else {
        const pools = (await client.request<Array<{ name: string }>>("GET", "/1.0/storage-pools?recursion=1")).metadata;
        if (pools[0]) devices.root = { type: "disk", path: "/", pool: pools[0].name };
      }
      changed = true;
    }
    if (!nicOf(devices)) {
      const nic = nicOf(source);
      if (nic) devices[nic[0]] = { ...nic[1] };
      else {
        const networks = (await client.request<Array<{ name: string; type: string; managed: boolean }>>("GET", "/1.0/networks?recursion=1")).metadata;
        const bridge = networks.find((n) => n.managed && n.type === "bridge");
        if (bridge) devices.eth0 = { type: "nic", name: "eth0", network: bridge.name };
      }
      changed = true;
    }
  }
  if (quotas.cpu !== undefined && !config["limits.cpu"]) {
    config["limits.cpu"] = String(Math.min(DEFAULT_CPU, quotas.cpu));
    changed = true;
  }
  if (quotas.memory !== undefined && !config["limits.memory"]) {
    config["limits.memory"] = `${Math.min(DEFAULT_MEMORY_GIB, quotas.memory)}GiB`;
    changed = true;
  }
  const root = rootOf(devices);
  if (quotas.disk !== undefined && root && !root[1].size) {
    devices[root[0]] = { ...root[1], size: `${Math.min(DEFAULT_DISK_GIB, quotas.disk)}GiB` };
    changed = true;
  }
  if (changed) await client.request("PUT", `/1.0/profiles/default${q}`, { config, description: profile.description ?? "", devices });
}
