import { handleEtagResponse, handleResponse } from "util/helpers";
import type { LxdNetworkAddressSet } from "types/network";
import type { LxdApiResponse, LxdSyncResponse } from "types/apiResponse";
import { ROOT_PATH } from "util/rootPath";

// Network address sets are project-scoped named groups of IPs/CIDRs/ranges,
// referenced from ACL rules. Incus handles CRUD synchronously.

export const fetchNetworkAddressSets = async (
  project: string,
): Promise<LxdNetworkAddressSet[]> => {
  const params = new URLSearchParams();
  params.set("project", project);
  params.set("recursion", "1");

  return fetch(`${ROOT_PATH}/1.0/network-address-sets?${params.toString()}`)
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdNetworkAddressSet[]>) => {
      return data.metadata;
    });
};

export const fetchNetworkAddressSet = async (
  name: string,
  project: string,
): Promise<LxdNetworkAddressSet> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-address-sets/${encodeURIComponent(name)}?${params.toString()}`,
  )
    .then(handleEtagResponse)
    .then((data) => {
      return data as LxdNetworkAddressSet;
    });
};

export const createNetworkAddressSet = async (
  addressSet: LxdNetworkAddressSet,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(`${ROOT_PATH}/1.0/network-address-sets?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(addressSet),
  })
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const updateNetworkAddressSet = async (
  addressSet: LxdNetworkAddressSet,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-address-sets/${encodeURIComponent(addressSet.name)}?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": addressSet.etag ?? "",
      },
      body: JSON.stringify(addressSet),
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const renameNetworkAddressSet = async (
  oldName: string,
  newName: string,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-address-sets/${encodeURIComponent(oldName)}?${params.toString()}`,
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

export const deleteNetworkAddressSet = async (
  name: string,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-address-sets/${encodeURIComponent(name)}?${params.toString()}`,
    {
      method: "DELETE",
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};
