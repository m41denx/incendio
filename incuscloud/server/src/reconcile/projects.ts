import type { IncusAdminClient } from "../incus/admin-client.ts";
import { ClusterError } from "../incus/admin-client.ts";
import type { Quotas } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";

export const TENANT_KEY = "user.incuscloud.tenant";

/** Restricted tenant project (spec D5): own images, profiles and volumes, the cluster's networks, limits from quotas. */
export function projectConfigFor(tenant: { id: string; quotas: Quotas }): Record<string, string> {
  const q = tenant.quotas;
  return {
    restricted: "true",
    "features.images": "true",
    "features.profiles": "true",
    "features.storage.volumes": "true",
    "features.storage.buckets": "true",
    "features.networks": "false",
    [TENANT_KEY]: tenant.id,
    ...(q.instances !== undefined && { "limits.instances": String(q.instances) }),
    ...(q.cpu !== undefined && { "limits.cpu": String(q.cpu) }),
    ...(q.memory !== undefined && { "limits.memory": `${q.memory}GiB` }),
    ...(q.disk !== undefined && { "limits.disk": `${q.disk}GiB` }),
  };
}

// Kept in line with projectConfigFor on existing projects; features.* cannot change once a project has content.
const UPDATABLE = (k: string) => k === "restricted" || k.startsWith("limits.") || k === TENANT_KEY;

/** Creates the tenant's project, or brings its limits in line. Refuses a same-named project that is not this tenant's. */
export async function ensureProject(client: IncusAdminClient, name: string, tenant: { id: string; slug: string; quotas: Quotas }): Promise<"created" | "updated" | "unchanged"> {
  const want = projectConfigFor(tenant);
  let current: Record<string, string>;
  try {
    current = (await client.request<{ config: Record<string, string> }>("GET", `/1.0/projects/${encodeURIComponent(name)}`)).metadata.config ?? {};
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
  for (const k of Object.keys(current)) if (k.startsWith("limits.") && !(k in want)) patch[k] = "";
  if (!Object.keys(patch).length) return "unchanged";
  await client.request("PATCH", `/1.0/projects/${encodeURIComponent(name)}`, { config: patch });
  return "updated";
}

type Devices = Record<string, Record<string, string>>;
const rootOf = (d: Devices) => Object.entries(d).find(([, v]) => v.type === "disk" && v.path === "/");
const nicOf = (d: Devices) => Object.entries(d).find(([, v]) => v.type === "nic");

/** Gives the project's default profile a root disk and a NIC when it lacks them, so instances can start. */
export async function ensureDefaultProfile(client: IncusAdminClient, project: string): Promise<void> {
  const q = `?project=${encodeURIComponent(project)}`;
  const profile = (await client.request<{ config: Record<string, string>; devices: Devices; description?: string }>("GET", `/1.0/profiles/default${q}`)).metadata;
  const devices: Devices = { ...profile.devices };
  if (rootOf(devices) && nicOf(devices)) return;
  const source = (await client.request<{ devices: Devices }>("GET", "/1.0/profiles/default?project=default")).metadata.devices ?? {};
  if (!rootOf(devices)) {
    const root = rootOf(source);
    if (root) devices[root[0]] = root[1];
    else {
      const pools = (await client.request<Array<{ name: string }>>("GET", "/1.0/storage-pools?recursion=1")).metadata;
      if (pools[0]) devices.root = { type: "disk", path: "/", pool: pools[0].name };
    }
  }
  if (!nicOf(devices)) {
    const nic = nicOf(source);
    if (nic) devices[nic[0]] = nic[1];
    else {
      const networks = (await client.request<Array<{ name: string; type: string; managed: boolean }>>("GET", "/1.0/networks?recursion=1")).metadata;
      const bridge = networks.find((n) => n.managed && n.type === "bridge");
      if (bridge) devices.eth0 = { type: "nic", name: "eth0", network: bridge.name };
    }
  }
  await client.request("PUT", `/1.0/profiles/default${q}`, { config: profile.config ?? {}, description: profile.description ?? "", devices });
}
