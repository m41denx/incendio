import { ClusterError, type IncusAdminClient, type IncusServer } from "../incus/admin-client.ts";
import type { SourceInstance, TargetFacts } from "./preflight.ts";

type Client = Pick<IncusAdminClient, "request">;

const get = async <T>(c: Client, path: string): Promise<T> => (await c.request<T>("GET", path)).metadata;
const names = (urls: string[]) => urls.map((u) => decodeURIComponent(u.split("?")[0]!.split("/").at(-1)!));
const q = (project: string) => `project=${encodeURIComponent(project)}`;

interface IncusInstance {
  name: string;
  type: "container" | "virtual-machine";
  status: string;
  architecture: string;
  config: Record<string, string>;
  expanded_config: Record<string, string>;
  devices: Record<string, Record<string, string>>;
  expanded_devices: Record<string, Record<string, string>>;
  profiles: string[];
}

/** An instance as pre-flight needs it, or undefined when it does not exist. */
export async function readInstance(c: Client, project: string, name: string): Promise<IncusInstance | undefined> {
  try {
    return await get<IncusInstance>(c, `/1.0/instances/${encodeURIComponent(name)}?${q(project)}`);
  } catch (e) {
    if (e instanceof ClusterError && e.clusterStatus === 404) return undefined;
    throw e;
  }
}

/** The source instance, with its snapshot count and its server's API extensions. */
export async function sourceFacts(c: Client, project: string, name: string): Promise<SourceInstance> {
  const [server, inst, snaps] = await Promise.all([
    get<IncusServer>(c, "/1.0"),
    readInstance(c, project, name),
    get<string[]>(c, `/1.0/instances/${encodeURIComponent(name)}/snapshots?${q(project)}`).catch(() => []),
  ]);
  if (!inst) throw new ClusterError(404, `Source: instance ${project}/${name} not found`);
  return {
    name: inst.name,
    type: inst.type,
    status: inst.status,
    architecture: inst.architecture,
    config: inst.config,
    expandedConfig: inst.expanded_config,
    devices: inst.devices,
    profiles: inst.profiles,
    expandedDevices: inst.expanded_devices,
    snapshots: snaps.length,
    apiExtensions: server.api_extensions,
  };
}

/** What the target cluster offers in a project. A missing project leaves the project-scoped lists empty. */
export async function targetFacts(c: Client, project: string): Promise<TargetFacts> {
  const server = await get<IncusServer & { environment: { architectures?: string[] } }>(c, "/1.0");
  const projectExists = await get(c, `/1.0/projects/${encodeURIComponent(project)}`).then(
    () => true,
    (e) => {
      if (e instanceof ClusterError && e.clusterStatus === 404) return false;
      throw e;
    },
  );
  const members = server.environment.server_clustered ? await get<Array<{ architecture: string }>>(c, "/1.0/cluster/members?recursion=1").catch(() => []) : [];
  const architectures = [...new Set([...(server.environment.architectures ?? []), ...members.map((m) => m.architecture)])];
  const pools = names(await get<string[]>(c, "/1.0/storage-pools"));
  if (!projectExists) return { projectExists, architectures, pools, networks: [], profiles: [], instanceNames: [], defaultProfileDevices: {}, apiExtensions: server.api_extensions };
  const [networks, profiles, instances, defaultProfile] = await Promise.all([
    get<string[]>(c, `/1.0/networks?${q(project)}`),
    get<string[]>(c, `/1.0/profiles?${q(project)}`),
    get<string[]>(c, `/1.0/instances?${q(project)}`),
    get<{ devices: Record<string, Record<string, string>> }>(c, `/1.0/profiles/default?${q(project)}`).catch(() => ({ devices: {} })),
  ]);
  return {
    projectExists,
    architectures,
    pools,
    networks: names(networks),
    profiles: names(profiles),
    instanceNames: names(instances),
    defaultProfileDevices: defaultProfile.devices,
    apiExtensions: server.api_extensions,
  };
}
