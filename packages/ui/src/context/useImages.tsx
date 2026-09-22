import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import { useAuth } from "./auth";
import {
  fetchImagesInAllProjects,
  fetchLocalImagesInProject,
} from "api/images";
import type { LxdImage, RemoteImagesResult } from "types/image";
import { loadRemoteImagesLegacy } from "util/imageLegacy";
import { loadImagesFromAllRegistries } from "util/imageRegistry";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { useCurrentProject } from "context/useCurrentProject";
import { IMAGE_SERVERS_KEY, parseImageServers } from "util/imageServers";

export const useLocalImagesInProject = (
  project: string,
  enabled?: boolean,
): UseQueryResult<LxdImage[]> => {
  const { isFineGrained } = useAuth();
  return useQuery({
    queryKey: [queryKeys.images, project],
    queryFn: async () => fetchLocalImagesInProject(project, isFineGrained),
    enabled: (enabled ?? true) && isFineGrained !== null,
  });
};

export const useImagesInAllProjects = (
  enabled?: boolean,
): UseQueryResult<LxdImage[]> => {
  const { isFineGrained } = useAuth();
  return useQuery({
    queryKey: [queryKeys.images],
    queryFn: async () => fetchImagesInAllProjects(isFineGrained),
    enabled: (enabled ?? true) && isFineGrained !== null,
  });
};

export const useRemoteImages = (): UseQueryResult<RemoteImagesResult> => {
  const { isFineGrained } = useAuth();
  const { hasImageRegistries, settings } = useSupportedFeatures();
  const { project } = useCurrentProject();

  const userServersValue = settings?.config?.[IMAGE_SERVERS_KEY];
  const userServers = parseImageServers(userServersValue);

  const legacyResult = useQuery({
    queryKey: [
      queryKeys.images,
      "selector",
      hasImageRegistries,
      userServersValue,
    ],
    queryFn: async () => loadRemoteImagesLegacy(userServers),
    enabled: !hasImageRegistries,
  });

  const registryResult = useQuery({
    queryKey: [queryKeys.images, "selector", hasImageRegistries, project?.name],
    queryFn: async () => loadImagesFromAllRegistries(!!isFineGrained, project),
    enabled: hasImageRegistries && isFineGrained !== null && project !== null,
  });

  return hasImageRegistries ? registryResult : legacyResult;
};
