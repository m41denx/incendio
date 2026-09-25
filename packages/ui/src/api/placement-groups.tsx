// Placement groups on Incus, emulated (see util/placementGroups.ts): group
// definitions live in the project's user.placement-group.* config, members
// set user.placement.group, and Incendio's placement scriptlet enforces them.
// Same function names as LXD's placement-groups API client this replaces, so
// the pages built for it keep working.
import { handleEtagResponse, handleResponse } from "util/helpers";
import type { LxdPlacementGroup } from "types/placementGroup";
import type { LxdProject } from "types/project";
import type { LxdConfigPair } from "types/config";
import { fetchInstances } from "api/instances";
import { fetchProfiles } from "api/profiles";
import { updateProject } from "api/projects";
import { updateSettings } from "api/server";
import { ROOT_PATH } from "util/rootPath";
import {
  PLACEMENT_SCRIPTLET,
  PLACEMENT_SCRIPTLET_KEY,
  placementGroupsFromProject,
  withoutPlacementGroup,
  withPlacementGroup,
} from "util/placementGroups";

const fetchProjectWithEtag = async (project: string): Promise<LxdProject> =>
  fetch(`${ROOT_PATH}/1.0/projects/${encodeURIComponent(project)}`)
    .then(handleEtagResponse)
    .then((data) => data as LxdProject);

export const fetchPlacementGroups = async (
  project: string,
  isFineGrained: boolean | null,
): Promise<LxdPlacementGroup[]> => {
  const [projectData, instances, profiles] = await Promise.all([
    fetchProjectWithEtag(project),
    fetchInstances(project, isFineGrained, false),
    fetchProfiles(project, isFineGrained),
  ]);
  return placementGroupsFromProject(
    project,
    projectData.config,
    instances,
    profiles,
  );
};

export const fetchPlacementGroup = async (
  group: string,
  project: string,
  isFineGrained: boolean | null,
): Promise<LxdPlacementGroup> => {
  const found = (await fetchPlacementGroups(project, isFineGrained)).find(
    (item) => item.name === group,
  );
  if (!found) throw new Error(`Placement group ${group} not found`);
  return found;
};

const saveProjectConfig = async (
  project: string,
  change: (config: LxdConfigPair) => LxdConfigPair,
): Promise<void> => {
  // PUT with the ETag: a concurrent project edit fails instead of being lost.
  const current = await fetchProjectWithEtag(project);
  await updateProject({ ...current, config: change(current.config) });
};

/** `body` is the JSON of { name, description, config: { policy, rigor } }. */
export const createPlacementGroup = async (
  body: string,
  project: string,
): Promise<void> => {
  const group = JSON.parse(body) as LxdPlacementGroup;
  await saveProjectConfig(project, (config) => {
    if (config[`user.placement-group.${group.name}.policy`]) {
      throw new Error(`Placement group ${group.name} already exists`);
    }
    return withPlacementGroup(config, group);
  });
};

export const updatePlacementGroup = async (
  group: LxdPlacementGroup,
  project: string,
): Promise<void> => {
  await saveProjectConfig(project, (config) =>
    withPlacementGroup(config, group),
  );
};

export const deletePlacementGroup = async (
  name: string,
  project: string,
): Promise<void> => {
  await saveProjectConfig(project, (config) =>
    withoutPlacementGroup(config, name),
  );
};

/** Install (or update) Incendio's placement scriptlet, cluster-wide. */
export const installPlacementScriptlet = async (): Promise<void> => {
  await updateSettings({ [PLACEMENT_SCRIPTLET_KEY]: PLACEMENT_SCRIPTLET });
};

/** Current global scriptlet (settings may be cached, so read it fresh). */
export const fetchPlacementScriptlet = async (): Promise<string> => {
  const data = (await fetch(`${ROOT_PATH}/1.0`).then(handleResponse)) as {
    metadata: { config?: Record<string, string> };
  };
  return data.metadata.config?.[PLACEMENT_SCRIPTLET_KEY] ?? "";
};
