import { handleEtagResponse, handleResponse } from "util/helpers";
import type { LxdNetworkIntegration } from "types/network";
import type { LxdApiResponse, LxdSyncResponse } from "types/apiResponse";
import { ROOT_PATH } from "util/rootPath";

// Network integrations (OVN interconnect) are server-global entities, so unlike
// networks/ACLs they take no project scope. Incus handles create/update/delete
// synchronously (no background operation), matching the trust-store endpoints.

export const fetchNetworkIntegrations = async (): Promise<
  LxdNetworkIntegration[]
> => {
  return fetch(`${ROOT_PATH}/1.0/network-integrations?recursion=1`)
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdNetworkIntegration[]>) => {
      return data.metadata;
    });
};

export const fetchNetworkIntegration = async (
  name: string,
): Promise<LxdNetworkIntegration> => {
  return fetch(
    `${ROOT_PATH}/1.0/network-integrations/${encodeURIComponent(name)}`,
  )
    .then(handleEtagResponse)
    .then((data) => {
      return data as LxdNetworkIntegration;
    });
};

export const createNetworkIntegration = async (
  integration: LxdNetworkIntegration,
): Promise<LxdSyncResponse<null>> => {
  return fetch(`${ROOT_PATH}/1.0/network-integrations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(integration),
  })
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const updateNetworkIntegration = async (
  integration: LxdNetworkIntegration,
): Promise<LxdSyncResponse<null>> => {
  return fetch(
    `${ROOT_PATH}/1.0/network-integrations/${encodeURIComponent(integration.name)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": integration.etag ?? "",
      },
      body: JSON.stringify(integration),
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const renameNetworkIntegration = async (
  oldName: string,
  newName: string,
): Promise<LxdSyncResponse<null>> => {
  return fetch(
    `${ROOT_PATH}/1.0/network-integrations/${encodeURIComponent(oldName)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName }),
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const deleteNetworkIntegration = async (
  name: string,
): Promise<LxdSyncResponse<null>> => {
  return fetch(
    `${ROOT_PATH}/1.0/network-integrations/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};
