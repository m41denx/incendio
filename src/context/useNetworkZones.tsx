import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import type { LxdNetworkZone, LxdNetworkZoneRecord } from "types/network";
import {
  fetchNetworkZone,
  fetchNetworkZoneRecords,
  fetchNetworkZones,
} from "api/network-zones";
import { useSupportedFeatures } from "./useSupportedFeatures";

export const useNetworkZones = (
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdNetworkZone[]> => {
  const { hasNetworkZones } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.projects, project, queryKeys.networkZones],
    queryFn: async () => fetchNetworkZones(project),
    enabled: (enabled ?? true) && hasNetworkZones,
  });
};

export const useNetworkZone = (
  name: string,
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdNetworkZone> => {
  const { hasNetworkZones } = useSupportedFeatures();

  return useQuery({
    queryKey: [queryKeys.projects, project, queryKeys.networkZones, name],
    queryFn: async () => fetchNetworkZone(name, project),
    enabled: (enabled ?? true) && hasNetworkZones,
  });
};

export const useNetworkZoneRecords = (
  zone: string,
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdNetworkZoneRecord[]> => {
  const { hasNetworkZoneRecords } = useSupportedFeatures();

  return useQuery({
    queryKey: [
      queryKeys.projects,
      project,
      queryKeys.networkZones,
      zone,
      queryKeys.networkZoneRecords,
    ],
    queryFn: async () => fetchNetworkZoneRecords(zone, project),
    enabled: (enabled ?? true) && hasNetworkZoneRecords,
  });
};
