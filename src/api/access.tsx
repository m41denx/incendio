import { handleResponse } from "util/helpers";
import type { LxdApiResponse } from "types/apiResponse";
import type { LxdAccessEntry } from "types/access";
import { ROOT_PATH } from "util/rootPath";

// Read-only access lists (API extensions instance_access / project_access).
// Incus does not expose a permissions-management API; these endpoints only
// report who can currently interact with the resource and their role.
export const fetchInstanceAccess = async (
  name: string,
  project: string,
): Promise<LxdAccessEntry[]> => {
  return fetch(
    `${ROOT_PATH}/1.0/instances/${encodeURIComponent(name)}/access?project=${encodeURIComponent(project)}`,
  )
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdAccessEntry[]>) => {
      return data.metadata;
    });
};

export const fetchProjectAccess = async (
  project: string,
): Promise<LxdAccessEntry[]> => {
  return fetch(
    `${ROOT_PATH}/1.0/projects/${encodeURIComponent(project)}/access`,
  )
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdAccessEntry[]>) => {
      return data.metadata;
    });
};
