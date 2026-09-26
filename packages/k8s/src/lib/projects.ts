import { incusClient } from "./incus.ts";
import { env } from "../env.ts";
import { log } from "./log.ts";
import type { Role } from "../constants.ts";

// Incus project metadata is the source of truth for "is this ours?" — never the
// project name (see docs/k8s/deploy-model.md §5). `user.*` keys are untouched by
// Incus, so we stamp our own namespaced keys and detect on them.
export const PROJECT_KEYS = {
  managed: "user.incendio.managed",
  role: "user.incendio.role",
  cluster: "user.incendio.cluster",
  k8sVersion: "user.incendio.k8s-version",
  operator: "user.incendio.operator",
} as const;

export interface ProjectMetadata {
  role: Role;
  /** Cluster this project hosts (for `management` projects, the mgmt cluster). */
  cluster: string;
  /** Pinned Kubernetes version, e.g. "v1.37.0". */
  k8sVersion?: string;
  /** Name of the operator VM that manages this project. */
  operator?: string;
}

/** Shape of an Incus project as returned by GET /1.0/projects?recursion=1. */
export interface IncusProject {
  name: string;
  description?: string;
  config?: Record<string, string>;
}

/** Build the `config` map for an incendio-managed project. */
export function buildProjectConfig(
  meta: ProjectMetadata,
): Record<string, string> {
  const config: Record<string, string> = {
    [PROJECT_KEYS.managed]: "true",
    [PROJECT_KEYS.role]: meta.role,
    [PROJECT_KEYS.cluster]: meta.cluster,
  };
  if (meta.k8sVersion) config[PROJECT_KEYS.k8sVersion] = meta.k8sVersion;
  if (meta.operator) config[PROJECT_KEYS.operator] = meta.operator;
  return config;
}

/** The detector: a project is ours iff `user.incendio.managed == "true"`. */
export function isManaged(project: IncusProject): boolean {
  return project.config?.[PROJECT_KEYS.managed] === "true";
}

/** Read incendio metadata off a project, or null if it is not ours/valid. */
export function readMetadata(project: IncusProject): ProjectMetadata | null {
  if (!isManaged(project)) return null;
  const config = project.config ?? {};
  const role = config[PROJECT_KEYS.role];
  if (role !== "management" && role !== "workload") return null;
  return {
    role,
    cluster: config[PROJECT_KEYS.cluster] ?? "",
    k8sVersion: config[PROJECT_KEYS.k8sVersion],
    operator: config[PROJECT_KEYS.operator],
  };
}

/** Cosmetic, human-friendly project name. Logic must never depend on this. */
export function suggestProjectName(role: Role, cluster: string): string {
  return role === "management" ? "incendio-mgmt" : `k8s-${cluster}`;
}

/**
 * List incendio-managed projects, optionally filtered by role. Detection is
 * purely metadata-based; names are ignored.
 */
export async function listManagedProjects(
  role?: Role,
): Promise<IncusProject[]> {
  const client = incusClient();
  const { data } = await client.get("/1.0/projects?recursion=1");
  const projects: IncusProject[] = data?.metadata ?? [];
  return projects.filter((p) => {
    if (!isManaged(p)) return false;
    if (role && p.config?.[PROJECT_KEYS.role] !== role) return false;
    return true;
  });
}

/** Fetch a single project by name, or null if it does not exist. */
export async function getProject(name: string): Promise<IncusProject | null> {
  const client = incusClient();
  try {
    const { data } = await client.get(
      `/1.0/projects/${encodeURIComponent(name)}`,
    );
    return (data?.metadata ?? null) as IncusProject | null;
  } catch (error: unknown) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Create an incendio-managed project (one per workload cluster, plus one for
 * the management plane). Deleting the project is our one-shot teardown: its
 * instances/networks/profiles go with it. Idempotent: returns silently if a
 * project with the same name already exists.
 */
export async function createProject(
  name: string,
  meta: ProjectMetadata,
): Promise<void> {
  if (await getProject(name)) return;
  const client = incusClient();
  await client.post("/1.0/projects", {
    name,
    description:
      `Incendio-managed ${meta.role} project` +
      (meta.cluster ? ` for cluster ${meta.cluster}` : ""),
    config: buildProjectConfig(meta),
  });
}

/**
 * CAPN launches every instance (load balancer, control-plane and worker
 * machines) with `profiles: [default]` in the workload project named by the
 * identity secret. A freshly-created Incus project gets an *empty* `default`
 * profile, so instances fail to start with "No root device could be found"
 * (validated on a live appliance). We therefore stamp the project's default
 * profile with a root disk + NIC before handing the project to CAPN.
 */
export async function ensureWorkloadProfile(
  project: string,
  pool: string,
  network: string,
): Promise<void> {
  const client = incusClient();
  await client.put(
    `/1.0/profiles/default?project=${encodeURIComponent(project)}`,
    {
      description: "Incendio workload default profile (root disk + NIC for CAPN)",
      config: {},
      devices: {
        root: { type: "disk", path: "/", pool },
        eth0: { type: "nic", network },
      },
    },
  );
  log.info(
    `workload project '${project}': default profile set (pool=${pool} network=${network})`,
  );
}

/**
 * Profile that pins the cluster's load balancer to `address`: the default
 * profile's NIC again, with a static DHCP lease. CAPN launches the load
 * balancer with `profiles: [default, <this>]`, so this `eth0` wins. See
 * endpoint-pin.ts for why the endpoint needs a fixed IPv4.
 */
export async function ensureLoadBalancerProfile(
  project: string,
  name: string,
  network: string,
  address: string,
): Promise<void> {
  const client = incusClient();
  const body = {
    description: `Incendio: control plane load balancer at ${address}`,
    config: {},
    devices: { eth0: { type: "nic", network, "ipv4.address": address } },
  };
  const query = `project=${encodeURIComponent(project)}`;
  try {
    await client.post(`/1.0/profiles?${query}`, { name, ...body });
  } catch (error: unknown) {
    if (httpStatus(error) !== 409) throw error;
    await client.put(`/1.0/profiles/${encodeURIComponent(name)}?${query}`, body);
  }
  log.info(`workload project '${project}': load balancer pinned to ${address} (${network})`);
}

interface IncusStoragePool {
  name: string;
  status?: string;
}

interface IncusNetwork {
  name: string;
  type?: string;
  managed?: boolean;
  config?: Record<string, string>;
}

/**
 * Resolve the storage pool + network to back a workload project's default
 * profile. Honors WORKLOAD_STORAGE_POOL / WORKLOAD_NETWORK when set, otherwise
 * auto-detects: the first created storage pool, and the first managed
 * bridge/OVN network that hands out an IPv4 (so CAPN instances get an address
 * the mgmt cluster can reach).
 */
export async function resolveWorkloadResources(): Promise<{
  pool: string;
  network: string;
}> {
  const client = incusClient();
  let pool = env.WORKLOAD_STORAGE_POOL;
  if (!pool) {
    const { data } = await client.get("/1.0/storage-pools?recursion=1");
    const pools: IncusStoragePool[] = data?.metadata ?? [];
    const created = pools.find((p) => p.status === "Created") ?? pools[0];
    if (!created) throw new Error("no Incus storage pool available for workload instances");
    pool = created.name;
  }
  let network = env.WORKLOAD_NETWORK;
  if (!network) {
    const { data } = await client.get("/1.0/networks?recursion=1");
    const networks: IncusNetwork[] = data?.metadata ?? [];
    const usable = networks.find(
      (n) =>
        n.managed === true &&
        (n.type === "bridge" || n.type === "ovn") &&
        !!n.config?.["ipv4.address"] &&
        n.config["ipv4.address"] !== "none",
    );
    if (!usable) throw new Error("no managed Incus network available for workload instances");
    network = usable.name;
  }
  return { pool, network };
}

/** If `data` is an async Incus operation, wait for it to finish. */
async function waitForOp(data: unknown): Promise<void> {
  const op = data as { type?: string; operation?: string } | null;
  if (op?.type === "async" && typeof op.operation === "string") {
    await incusClient().get(`${op.operation}/wait?timeout=60`);
  }
}

function lastPathSegment(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? "";
}

/**
 * Force-empty a project so it can be deleted. Incus refuses to delete a
 * non-empty project, and CAPN leaves two things behind: any instances (only
 * when the CAPI cascade did not run, e.g. the mgmt cluster was unreachable) and
 * the per-project *cached images* it pulled to launch them (haproxy + the
 * kubeadm node image). We force-stop and delete instances, then delete images
 * and any profile the agent added (incendio-lb).
 */
async function emptyProject(name: string): Promise<void> {
  const client = incusClient();
  const project = encodeURIComponent(name);

  const { data: instData } = await client.get(`/1.0/instances?project=${project}`);
  const instances: string[] = instData?.metadata ?? [];
  for (const url of instances) {
    const inst = lastPathSegment(url);
    try {
      const stop = await client.put(`/1.0/instances/${inst}/state?project=${project}`, {
        action: "stop",
        timeout: 30,
        force: true,
      });
      await waitForOp(stop.data);
    } catch (error: unknown) {
      // Already stopped is fine; anything else surfaces on the delete below.
      if (!isBadRequest(error)) log.warn(`stop instance ${inst}: ${String(error)}`);
    }
    const del = await client.delete(`/1.0/instances/${inst}?project=${project}`);
    await waitForOp(del.data);
  }

  const { data: imgData } = await client.get(`/1.0/images?project=${project}`);
  const images: string[] = imgData?.metadata ?? [];
  for (const url of images) {
    const fingerprint = lastPathSegment(url);
    const del = await client.delete(`/1.0/images/${fingerprint}?project=${project}`);
    await waitForOp(del.data);
  }

  // Profiles besides `default` (the pinned load balancer's) also block it.
  const { data: profileData } = await client.get(`/1.0/profiles?project=${project}`);
  const profiles: string[] = profileData?.metadata ?? [];
  for (const url of profiles) {
    const profile = decodeURIComponent(lastPathSegment(url).split("?")[0] ?? "");
    if (profile === "default" || profile === "") continue;
    await client.delete(`/1.0/profiles/${encodeURIComponent(profile)}?project=${project}`);
  }
}

/**
 * Delete a project (one-shot teardown). Empties it first (force-removing any
 * leftover instances and CAPN's cached images), then removes the project —
 * which takes its profiles/networks with it. No-op if it does not exist.
 */
export async function deleteProject(name: string): Promise<void> {
  if (!(await getProject(name))) return;
  await emptyProject(name);
  const client = incusClient();
  try {
    await client.delete(`/1.0/projects/${encodeURIComponent(name)}`);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return httpStatus(error) === 404;
}

function isBadRequest(error: unknown): boolean {
  return httpStatus(error) === 400;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "response" in error) {
    return (error as { response?: { status?: number } }).response?.status;
  }
  return undefined;
}
