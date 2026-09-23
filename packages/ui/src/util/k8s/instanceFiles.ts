// Read-only access to files inside an Incus instance via the file API — how
// the UI inspects the management appliance and cluster nodes' bootstrap
// without a shell.
import { ROOT_PATH } from "util/rootPath";

const fileUrl = (project: string, instance: string, path: string): string => {
  const params = new URLSearchParams({ project, path });
  return `${ROOT_PATH}/1.0/instances/${encodeURIComponent(instance)}/files?${params.toString()}`;
};

/** A regular file's contents, or null if it does not exist. */
export const readInstanceFile = async (
  project: string,
  instance: string,
  path: string,
): Promise<string | null> => {
  const res = await fetch(fileUrl(project, instance, path));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reading ${path}: HTTP ${res.status}`);
  // The file API returns a symlink's target path rather than its contents.
  const type =
    res.headers.get("x-incus-type") ?? res.headers.get("x-lxd-type") ?? "file";
  if (type !== "file") throw new Error(`reading ${path}: not a file (${type})`);
  return res.text();
};

/** Whether a path exists in the instance. */
export const instanceFileExists = async (
  project: string,
  instance: string,
  path: string,
): Promise<boolean> => {
  const res = await fetch(fileUrl(project, instance, path), { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`checking ${path}: HTTP ${res.status}`);
  return true;
};
