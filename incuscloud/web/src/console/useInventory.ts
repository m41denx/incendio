import { useQueries, useQuery } from "@tanstack/react-query";
import { ApiError, incusAll, request } from "../api/client";
import { clusterOf, nameOf } from "../pages/inventory/tree";
import { buildView, type InventoryData, type TreeItem, type View } from "./views";

const REFRESH = { staleTime: 15_000, refetchInterval: 30_000 };

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
    queryKey: ["inventory", "projects"],
    queryFn: () => incusAll<InventoryData["projects"]>("/1.0/projects?recursion=1"),
    enabled: view === "projects",
    ...REFRESH,
  });
  const pools = useQuery({
    queryKey: ["inventory", "pools"],
    queryFn: () => incusAll<InventoryData["pools"]>("/1.0/storage-pools?recursion=1"),
    enabled: view === "storage",
    ...REFRESH,
  });
  const names = [...new Set([...(clusters.data ?? []).map((c) => c.name), ...(members.data ?? []).map((m) => clusterOf(m.server_name))])].filter(Boolean).sort();
  const networks = useQueries({
    queries: names.map((c) => ({
      queryKey: ["inventory", "networks", c],
      queryFn: () => incusAll<Array<{ name: string; managed: boolean }>>(`/1.0/networks?project=${encodeURIComponent(`default@${c}`)}&recursion=1`),
      enabled: view === "networks",
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
  };
  const shown = [clusters, members, ...(withInstances ? [instances] : []), ...(view === "projects" ? [projects] : []), ...(view === "storage" ? [pools] : []), ...(view === "networks" ? networks : [])];
  return {
    root: buildView(view, data),
    isLoading: shown.some((q) => q.isLoading),
    errors: shown.flatMap((q) => (q.error ? [(q.error as Error).message] : [])),
  };
}
