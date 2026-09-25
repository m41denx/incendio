// Incus file API, shared by instances (/1.0/instances/{name}/files) and
// custom filesystem volumes (/1.0/storage-pools/{pool}/volumes/custom/{name}/files,
// `file_storage_volume`). Same verbs and headers on both.
import axios, { isAxiosError } from "axios";
import { handleResponse } from "util/helpers";
import { ROOT_PATH } from "util/rootPath";
import { fileHeader } from "util/fileExplorer";
import type { LxdInstance } from "types/instance";
import type { LxdStorageVolume } from "types/storage";
import type { UploadState } from "types/upload";
import { hasLocation } from "util/storageVolume";

export interface FileTarget {
  /** The resource's /files endpoint, without query string. */
  endpoint: string;
  /** project, and target for volumes that live on one cluster member. */
  params: Record<string, string>;
}

export interface FileMetadata {
  type: string;
  modified: string | null;
  mode: string | null;
  uid: string | null;
  gid: string | null;
}

export const instanceFileTarget = (instance: LxdInstance): FileTarget => ({
  endpoint: `${ROOT_PATH}/1.0/instances/${encodeURIComponent(instance.name)}/files`,
  params: { project: instance.project },
});

export const volumeFileTarget = (volume: LxdStorageVolume): FileTarget => ({
  endpoint: `${ROOT_PATH}/1.0/storage-pools/${encodeURIComponent(volume.pool)}/volumes/custom/${encodeURIComponent(volume.name)}/files`,
  params: {
    project: volume.project,
    ...(hasLocation(volume) ? { target: volume.location } : {}),
  },
});

export const fileUrl = (target: FileTarget, path: string): string =>
  `${target.endpoint}?${new URLSearchParams({ ...target.params, path }).toString()}`;

/** Entry names in a directory. */
export const fetchDirectory = async (
  target: FileTarget,
  path: string,
): Promise<string[]> => {
  const data = (await fetch(fileUrl(target, path)).then(handleResponse)) as {
    metadata: string[] | null;
  };
  return data.metadata ?? [];
};

export const fetchFileMetadata = async (
  target: FileTarget,
  path: string,
): Promise<FileMetadata> => {
  const res = await fetch(fileUrl(target, path), { method: "HEAD" });
  if (!res.ok) {
    throw new Error(`Reading ${path} failed: ${res.status} ${res.statusText}`);
  }
  return {
    type: fileHeader(res.headers, "type") ?? "unknown",
    modified: fileHeader(res.headers, "modified"),
    mode: fileHeader(res.headers, "mode"),
    uid: fileHeader(res.headers, "uid"),
    gid: fileHeader(res.headers, "gid"),
  };
};

/** Delete a file, or a directory with everything in it. */
export const deleteFile = async (
  target: FileTarget,
  path: string,
  recursive: boolean,
): Promise<void> => {
  await fetch(fileUrl(target, path), {
    method: "DELETE",
    headers: recursive ? { "X-Incus-force": "true" } : {},
  }).then(handleResponse);
};

export const createDirectory = async (
  target: FileTarget,
  path: string,
): Promise<void> => {
  await fetch(fileUrl(target, path), {
    method: "POST",
    headers: { "X-Incus-type": "directory" },
  }).then(handleResponse);
};

/** Write a file (created, or replaced if it exists). */
export const uploadFile = async (
  target: FileTarget,
  path: string,
  file: File,
  onProgress: (state: UploadState) => void,
  signal: AbortSignal,
): Promise<void> => {
  await axios
    .post(fileUrl(target, path), file, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Incus-type": "file",
        "X-Incus-write": "overwrite",
      },
      onUploadProgress: (event) => {
        onProgress({
          percentage: event.progress ? Math.floor(event.progress * 100) : 0,
          loaded: event.loaded,
          total: event.total,
        });
      },
      signal,
    })
    .catch((error: unknown) => {
      // Surface Incus' own error message rather than axios' status line.
      if (
        isAxiosError<{ error?: string }>(error) &&
        error.response?.data?.error
      ) {
        throw new Error(error.response.data.error);
      }
      throw error;
    });
};
