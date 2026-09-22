import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import {
  fetchInstance,
  fetchInstanceNVRAM,
  fetchInstances,
} from "api/instances";
import { useAuth } from "./auth";
import { useSupportedFeatures } from "./useSupportedFeatures";
import type { LxdInstance, LxdInstanceNVRAM } from "types/instance";

export const useInstances = (
  project: string | null,
  filter?: string,
): UseQueryResult<LxdInstance[]> => {
  const { isFineGrained } = useAuth();
  const { hasInstanceStateSelectiveRecursion } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.instances, project],
    queryFn: async () =>
      fetchInstances(
        project,
        isFineGrained,
        hasInstanceStateSelectiveRecursion,
        filter,
      ),
    enabled: isFineGrained !== null,
  });
};

export const useInstance = (
  name: string,
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdInstance> => {
  const { isFineGrained } = useAuth();
  const { hasInstanceStateSelectiveRecursion } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.instances, name, project],
    queryFn: async () =>
      fetchInstance(
        name,
        project,
        isFineGrained,
        hasInstanceStateSelectiveRecursion,
      ),
    enabled: (enabled ?? true) && isFineGrained !== null,
  });
};

export const useInstanceNVRAM = (
  name: string,
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdInstanceNVRAM> => {
  return useQuery({
    queryKey: [queryKeys.instances, name, project, queryKeys.nvram],
    queryFn: async () => fetchInstanceNVRAM(name, project),
    enabled: enabled ?? true,
  });
};
