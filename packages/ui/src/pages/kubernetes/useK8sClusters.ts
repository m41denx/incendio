import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useToastNotification } from "@canonical/react-components";
import { agentRequest } from "util/k8s/agent";
import type { K8sMachine } from "util/k8s/clusterNodes";
import { useAgentConfig } from "pages/kubernetes/useK8sManagement";
import { buildTemplateVariables, type K8sClusterConfig } from "util/k8s/capn";

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
  // Live overlay from the CAPI/CAPN CRDs when the mgmt cluster is reachable
  // (source "crd"); absent when the agent served the value from its cache.
  source?: "cache" | "crd";
  phase?: string;
  // Why the cluster is not Available yet (CAPI's aggregated condition message).
  message?: string;
  // Workload cluster API server (https://host:port).
  endpoint?: string;
  controlPlaneReady?: number;
  workerReady?: number;
  createdAt: string;
  updatedAt: string;
}

const CLUSTERS_KEY = ["k8s", "clusters"];

// `agentReachable` keeps the list from erroring (and notifying) every poll while
// the appliance is still bootstrapping or its certificate is unapproved.
export const useK8sClusters = (
  agentReachable: boolean,
): UseQueryResult<K8sClusterRecord[]> => {
  const config = useAgentConfig();
  const enabled =
    agentReachable && config.url.length > 0 && config.token.length > 0;
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

export interface K8sCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

/** GET /v1/clusters/:name/status — live from the CRDs, cache fallback. */
export interface K8sClusterStatus {
  name: string;
  status: string;
  ready: boolean;
  source: "cache" | "crd";
  controlPlane: { desired: number; ready: number | null };
  workers: { desired: number; ready: number | null };
  phase?: string;
  message?: string;
  endpoint?: string;
  machines?: K8sMachine[];
  conditions: K8sCondition[];
  updatedAt: string;
}

export const useK8sClusterStatus = (
  name: string,
  agentReachable: boolean,
): UseQueryResult<K8sClusterStatus> => {
  const config = useAgentConfig();
  return useQuery({
    queryKey: [...CLUSTERS_KEY, config.url, name, "status"],
    queryFn: async () =>
      agentRequest<K8sClusterStatus>(
        config,
        `/v1/clusters/${encodeURIComponent(name)}/status`,
      ),
    enabled: agentReachable && config.url.length > 0 && name.length > 0,
    refetchInterval: 5000,
  });
};

/** Admin kubeconfig — fetched only when `enabled` (it is a credential). */
export const useK8sKubeconfig = (
  name: string,
  enabled: boolean,
): UseQueryResult<string> => {
  const config = useAgentConfig();
  return useQuery({
    queryKey: [...CLUSTERS_KEY, config.url, name, "kubeconfig"],
    queryFn: async () => {
      const result = await agentRequest<{ kubeconfig: string }>(
        config,
        `/v1/clusters/${encodeURIComponent(name)}/kubeconfig`,
      );
      return result.kubeconfig;
    },
    enabled: enabled && config.url.length > 0,
    retry: false,
    staleTime: Infinity,
  });
};

export const useCreateK8sCluster = (): UseMutationResult<
  { name: string; project: string },
  Error,
  K8sClusterConfig
> => {
  const queryClient = useQueryClient();
  const config = useAgentConfig();
  return useMutation({
    mutationFn: async (cluster: K8sClusterConfig) =>
      agentRequest<{ name: string; project: string }>(config, "/v1/clusters", {
        method: "POST",
        body: JSON.stringify({
          name: cluster.clusterName,
          kubernetesVersion: cluster.kubernetesVersion,
          controlPlaneCount: cluster.controlPlaneCount,
          workerCount: cluster.workerCount,
          // Every other form option (CNI, flavors, profiles, load balancer,
          // image, CIDRs...) as the same template variables the preview shows.
          variables: buildTemplateVariables(cluster),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CLUSTERS_KEY });
    },
  });
};

export interface K8sScaleRequest {
  controlPlaneCount?: number;
  workerCount?: number;
}

/** PATCH /v1/clusters/:name — edits replicas in the CAPI topology. */
export const useScaleK8sCluster = (
  name: string,
): UseMutationResult<K8sClusterRecord, Error, K8sScaleRequest> => {
  const queryClient = useQueryClient();
  const config = useAgentConfig();
  return useMutation({
    mutationFn: async (request: K8sScaleRequest) =>
      agentRequest<K8sClusterRecord>(
        config,
        `/v1/clusters/${encodeURIComponent(name)}`,
        { method: "PATCH", body: JSON.stringify(request) },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CLUSTERS_KEY });
    },
  });
};

const DELETE_CLUSTER_KEY = ["k8s", "delete-cluster"];

export const useDeleteK8sCluster = (): UseMutationResult<
  { deleted: string; project: string | null },
  Error,
  string
> => {
  const queryClient = useQueryClient();
  const config = useAgentConfig();
  const toastNotify = useToastNotification();
  return useMutation({
    mutationKey: DELETE_CLUSTER_KEY,
    mutationFn: async (name: string) =>
      agentRequest<{ deleted: string; project: string | null }>(
        config,
        `/v1/clusters/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      ),
    // Hook-level callbacks still run after the page that started the delete
    // has navigated away (the detail page leaves as soon as it is confirmed;
    // the CAPI teardown behind this request takes minutes).
    onSuccess: async (_result, name) => {
      toastNotify.success(`Cluster "${name}" deleted.`);
      await queryClient.invalidateQueries({ queryKey: CLUSTERS_KEY });
    },
    onError: (error, name) => {
      toastNotify.failure(`Deleting cluster "${name}" failed`, error);
    },
  });
};

/** Names of clusters with a delete request still in flight. */
export const useDeletingClusters = (): Set<string> =>
  new Set(
    useMutationState({
      filters: { mutationKey: DELETE_CLUSTER_KEY, status: "pending" },
      select: (mutation) => mutation.state.variables as string,
    }),
  );
