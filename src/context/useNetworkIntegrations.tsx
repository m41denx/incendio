import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import type { LxdNetworkIntegration } from "types/network";
import {
  fetchNetworkIntegration,
  fetchNetworkIntegrations,
} from "api/network-integrations";
import { useSupportedFeatures } from "./useSupportedFeatures";

export const useNetworkIntegrations = (
  enabled?: boolean,
): UseQueryResult<LxdNetworkIntegration[]> => {
  const { hasNetworkIntegrations } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.networkIntegrations],
    queryFn: fetchNetworkIntegrations,
    enabled: (enabled ?? true) && hasNetworkIntegrations,
  });
};

export const useNetworkIntegration = (
  name: string,
  enabled?: boolean,
): UseQueryResult<LxdNetworkIntegration> => {
  const { hasNetworkIntegrations } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.networkIntegrations, name],
    queryFn: async () => fetchNetworkIntegration(name),
    enabled: (enabled ?? true) && hasNetworkIntegrations,
  });
};
