import { useQueries, useQuery } from "@tanstack/react-query";
import { ApiError, incusAll, request } from "../api/client";
import { clusterOf, nameOf } from "../pages/inventory/tree";
import { homeProject } from "./object";
import { buildView, type InventoryData, type TreeItem, type View } from "./views";

const REFRESH = { staleTime: 15_000, refetchInterval: 30_000 };

const PROJECTS = { queryKey: ["inventory", "projects"], queryFn: () => incusAll<InventoryData["projects"]>("/1.0/projects?recursion=1") };

/** Where each cluster's own pages open for the caller: see homeProject. */
export function useHome(): (cluster: string) => string {
  const { data } = useQuery({ ...PROJECTS, ...REFRESH });
  const names = (data ?? []).map((p) => p.name);
  return (cluster) => homeProject(cluster, names);
}

const withoutCounts = (t: TreeItem): TreeItem => ({ ...t, count: undefined, children: t.children?.map(withoutCounts) });

/** The cluster list, or none for callers who may not read it (tenant members). */
const clusterList = async () => {
  try {
    return await request<Array<{ name: string; status: string }>>("GET", "/api/v1/clusters");
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
};

/**
 * The sidebar tree for a view, over every cluster. Its queries are its own
 * (`["inventory", …]`), so no page's cache is read or changed; a view loads
 * only what it shows.
 */
export function useInventory(view: View): { root: TreeItem; isLoading: boolean; errors: string[] } {
  const withInstances = view === "instances" || view === "projects";
  const clusters = useQuery({ queryKey: ["inventory", "clusters"], queryFn: clusterList, retry: false, ...REFRESH });
  const members = useQuery({
    queryKey: ["inventory", "members"],
    queryFn: () => incusAll<InventoryData["members"]>("/1.0/cluster/members?recursion=1"),
    ...REFRESH,
  });
  const instances = useQuery({
    queryKey: ["inventory", "instances"],
    queryFn: () => incusAll<InventoryData["instances"]>("/1.0/instances?all-projects=true&recursion=1"),
    enabled: withInstances,
    ...REFRESH,
  });
  const projects = useQuery({
    ...PROJECTS,
    // Also where a cluster's networks and pools open (homeProject).
    enabled: view === "projects" || view === "networks" || view === "storage",
    ...REFRESH,
  });
  const pools = useQuery({
    queryKey: ["inventory", "pools"],
    queryFn: () => incusAll<InventoryData["pools"]>("/1.0/storage-pools?recursion=1"),
    enabled: view === "storage",
    ...REFRESH,
  });
  // Kubernetes clusters (none when IncusCloud has no management cluster).
  const kubernetes = useQuery({
    queryKey: ["inventory", "kubernetes"],
    queryFn: async () => {
      try {
        return await request<Array<{ name: string; project: string; clusterName: string; status: string }>>("GET", "/api/v1/kubernetes");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return [];
        throw e;
      }
    },
    enabled: view === "projects",
    ...REFRESH,
  });
  const projectNames = (projects.data ?? []).map((p) => p.name);
  const names = [...new Set([...(clusters.data ?? []).map((c) => c.name), ...(members.data ?? []).map((m) => clusterOf(m.server_name))])].filter(Boolean).sort();
  const networks = useQueries({
    queries: names.map((c) => ({
      queryKey: ["inventory", "networks", homeProject(c, projectNames)],
      queryFn: () => incusAll<Array<{ name: string; managed: boolean }>>(`/1.0/networks?project=${encodeURIComponent(homeProject(c, projectNames))}&recursion=1`),
      enabled: view === "networks" && projects.isSuccess,
      ...REFRESH,
    })),
  });

  const data: InventoryData = {
    clusters: clusters.data ?? [],
    members: members.data ?? [],
    projects: projects.data ?? [],
    instances: instances.data ?? [],
    networks: Object.fromEntries(names.map((c, i) => [c, (networks[i]?.data ?? []).map((n) => ({ ...n, name: nameOf(n.name) }))])),
    pools: pools.data ?? [],
    kubernetes: (kubernetes.data ?? []).map((k) => ({ name: k.name, project: `${k.project}@${k.clusterName}`, status: k.status })),
  };
  const shown = [clusters, members, ...(withInstances ? [instances] : []), ...(view === "projects" ? [kubernetes] : []), ...(view === "projects" || view === "networks" || view === "storage" ? [projects] : []), ...(view === "storage" ? [pools] : []), ...(view === "networks" ? networks : [])];
  // No counts until the instances are in: "0/0" would say there are none.
  const root = buildView(view, data);
  return {
    root: withInstances && instances.isPending ? withoutCounts(root) : root,
    isLoading: shown.some((q) => q.isLoading),
    errors: shown.flatMap((q) => (q.error ? [(q.error as Error).message] : [])),
  };
}
