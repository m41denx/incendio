import { handleEtagResponse, handleResponse } from "util/helpers";
import type { LxdNetworkZone, LxdNetworkZoneRecord } from "types/network";
import type { LxdApiResponse, LxdSyncResponse } from "types/apiResponse";
import { ROOT_PATH } from "util/rootPath";

// Network DNS zones are project-scoped. Incus handles CRUD synchronously.

export const fetchNetworkZones = async (
  project: string,
): Promise<LxdNetworkZone[]> => {
  const params = new URLSearchParams();
  params.set("project", project);
  params.set("recursion", "1");

  return fetch(`${ROOT_PATH}/1.0/network-zones?${params.toString()}`)
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdNetworkZone[]>) => {
      return data.metadata;
    });
};

export const fetchNetworkZone = async (
  name: string,
  project: string,
): Promise<LxdNetworkZone> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(name)}?${params.toString()}`,
  )
    .then(handleEtagResponse)
    .then((data) => {
      return data as LxdNetworkZone;
    });
};

export const createNetworkZone = async (
  zone: LxdNetworkZone,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(`${ROOT_PATH}/1.0/network-zones?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(zone),
  })
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const updateNetworkZone = async (
  zone: LxdNetworkZone,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(zone.name)}?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": zone.etag ?? "",
      },
      body: JSON.stringify(zone),
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const deleteNetworkZone = async (
  name: string,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(name)}?${params.toString()}`,
    { method: "DELETE" },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

// Records within a zone.

export const fetchNetworkZoneRecords = async (
  zone: string,
  project: string,
): Promise<LxdNetworkZoneRecord[]> => {
  const params = new URLSearchParams();
  params.set("project", project);
  params.set("recursion", "1");

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(zone)}/records?${params.toString()}`,
  )
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdNetworkZoneRecord[]>) => {
      return data.metadata;
    });
};

export const createNetworkZoneRecord = async (
  zone: string,
  record: LxdNetworkZoneRecord,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(zone)}/records?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const updateNetworkZoneRecord = async (
  zone: string,
  record: LxdNetworkZoneRecord,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(zone)}/records/${encodeURIComponent(record.name)}?${params.toString()}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};

export const deleteNetworkZoneRecord = async (
  zone: string,
  record: string,
  project: string,
): Promise<LxdSyncResponse<null>> => {
  const params = new URLSearchParams();
  params.set("project", project);

  return fetch(
    `${ROOT_PATH}/1.0/network-zones/${encodeURIComponent(zone)}/records/${encodeURIComponent(record)}?${params.toString()}`,
    { method: "DELETE" },
  )
    .then(handleResponse)
    .then((data: LxdSyncResponse<null>) => {
      return data;
    });
};
