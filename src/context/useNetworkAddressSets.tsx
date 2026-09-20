import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import type { LxdNetworkAddressSet } from "types/network";
import {
  fetchNetworkAddressSet,
  fetchNetworkAddressSets,
} from "api/network-address-sets";
import { useSupportedFeatures } from "./useSupportedFeatures";

export const useNetworkAddressSets = (
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdNetworkAddressSet[]> => {
  const { hasNetworkAddressSets } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.projects, project, queryKeys.networkAddressSets],
    queryFn: async () => fetchNetworkAddressSets(project),
    enabled: (enabled ?? true) && hasNetworkAddressSets,
  });
};

export const useNetworkAddressSet = (
  name: string,
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdNetworkAddressSet> => {
  const { hasNetworkAddressSets } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.projects, project, queryKeys.networkAddressSets, name],
    queryFn: async () => fetchNetworkAddressSet(name, project),
    enabled: (enabled ?? true) && hasNetworkAddressSets,
  });
};
