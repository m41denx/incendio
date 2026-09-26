import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { agentRequest } from "util/k8s/agent";
import { useAgentConfig } from "pages/kubernetes/useK8sManagement";

// The management cluster's Cluster API controllers (agent 0.3.1+): health, the
// nodes they cannot inspect, and a restart for when they are stuck on stale
// connections after the appliance was paused.

export interface K8sControllerRestart {
  at: string;
  reason: string;
  automatic: boolean;
  /** Absent while the restart is still rolling out. */
  ok?: boolean;
  error?: string;
}

export interface K8sControllers {
  deployments: {
    namespace: string;
    name: string;
    ready: number;
    desired: number;
  }[];
  unreachable: {
    cluster: string;
    machine: string;
    condition: string;
    message: string;
    since: string;
  }[];
  restarting: boolean;
  lastRestart?: K8sControllerRestart;
  watchdog: boolean;
}

const CONTROLLERS_KEY = ["k8s", "controllers"];

export const useK8sControllers = (
  enabled: boolean,
): UseQueryResult<K8sControllers> => {
  const config = useAgentConfig();
  return useQuery({
    queryKey: [...CONTROLLERS_KEY, config.url],
    queryFn: async () =>
      agentRequest<K8sControllers>(config, "/v1/management/controllers"),
    enabled: enabled && config.url.length > 0,
    refetchInterval: (query) => (query.state.data?.restarting ? 3_000 : 30_000),
  });
};

export const useRestartK8sControllers = (): UseMutationResult<
  K8sControllerRestart,
  Error,
  void
> => {
  const queryClient = useQueryClient();
  const config = useAgentConfig();
  return useMutation({
    mutationFn: async () =>
      agentRequest<K8sControllerRestart>(
        config,
        "/v1/management/controllers/restart",
        { method: "POST" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONTROLLERS_KEY });
    },
  });
};
