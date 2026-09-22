import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import type {
  LxdLoadBalancer,
  LxdLoadBalancerState,
} from "types/loadBalancers";
import {
  fetchLoadBalancer,
  fetchLoadBalancers,
  fetchLoadBalancerState,
} from "api/load-balancers";

export const useLoadBalancers = (
  network: string,
  project: string,
): UseQueryResult<LxdLoadBalancer[]> => {
  return useQuery({
    queryKey: [
      queryKeys.projects,
      project,
      queryKeys.networks,
      network,
      queryKeys.loadBalancers,
    ],
    queryFn: async () => fetchLoadBalancers(network, project),
  });
};

export const useLoadBalancer = (
  network: string,
  project: string,
  listenAddress: string,
): UseQueryResult<LxdLoadBalancer> => {
  return useQuery({
    queryKey: [
      queryKeys.projects,
      project,
      queryKeys.networks,
      network,
      queryKeys.loadBalancers,
      listenAddress,
    ],
    queryFn: async () => fetchLoadBalancer(network, project, listenAddress),
  });
};

export const useLoadBalancerState = (
  network: string,
  project: string,
  listenAddress: string,
  enabled?: boolean,
): UseQueryResult<LxdLoadBalancerState> => {
  return useQuery({
    queryKey: [
      queryKeys.projects,
      project,
      queryKeys.networks,
      network,
      queryKeys.loadBalancers,
      listenAddress,
      queryKeys.state,
    ],
    queryFn: async () =>
      fetchLoadBalancerState(network, project, listenAddress),
    enabled: enabled ?? true,
  });
};
