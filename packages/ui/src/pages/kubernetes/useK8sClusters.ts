import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { agentRequest, loadAgentConfig } from "util/k8s/agent";
import type { K8sClusterConfig } from "util/k8s/capn";

// Cluster list/create/delete against the agent's /v1/clusters API. Reads poll
// on an interval (SWR-style) so status changes surface without a manual
// refresh; the agent's sqlite cache is a projection of the CAPI/CAPN CRDs
// (docs/k8s/management-appliance.md §6).
export interface K8sClusterRecord {
  id: string;
  name: string;
  project: string | null;
  kubernetesVersion: string;
  controlPlaneCount: number;
  workerCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const CLUSTERS_KEY = ["k8s", "clusters"];

export const useK8sClusters = (): UseQueryResult<K8sClusterRecord[]> => {
  const config = loadAgentConfig();
  const enabled = config.url.length > 0 && config.token.length > 0;
  return useQuery({
    queryKey: [...CLUSTERS_KEY, config.url],
    queryFn: async () => {
      const result = await agentRequest<{ clusters: K8sClusterRecord[] }>(
        config,
        "/v1/clusters",
      );
      return result.clusters;
    },
    enabled,
    refetchInterval: 5000,
  });
};

export const useCreateK8sCluster = (): UseMutationResult<
  { name: string; project: string },
  Error,
  K8sClusterConfig
> => {
  const queryClient = useQueryClient();
  const config = loadAgentConfig();
  return useMutation({
    mutationFn: async (cluster: K8sClusterConfig) =>
      agentRequest<{ name: string; project: string }>(config, "/v1/clusters", {
        method: "POST",
        body: JSON.stringify({
          name: cluster.clusterName,
          kubernetesVersion: cluster.kubernetesVersion,
          controlPlaneCount: cluster.controlPlaneCount,
          workerCount: cluster.workerCount,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CLUSTERS_KEY });
    },
  });
};

export const useDeleteK8sCluster = (): UseMutationResult<
  { deleted: string; project: string | null },
  Error,
  string
> => {
  const queryClient = useQueryClient();
  const config = loadAgentConfig();
  return useMutation({
    mutationFn: async (name: string) =>
      agentRequest<{ deleted: string; project: string | null }>(
        config,
        `/v1/clusters/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CLUSTERS_KEY });
    },
  });
};
