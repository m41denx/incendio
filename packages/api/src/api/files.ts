import type { AxiosResponse } from "axios";
import { Resource } from "./base/request";
import type { IncusResponse, RequestContext, ScopeOptions } from "./base/types";

export type FileType = "file" | "directory" | "symlink";

export interface FileStat {
  type: FileType;
  uid: number;
  gid: number;
  /** Permission bits, e.g. `0o644` */
  mode: number;
  modified?: Date;
  /** Size in bytes (files only) */
  size?: number;
}

export type FileContent = { type: "file"; stat: FileStat; data: ArrayBuffer };
export type DirectoryContent = {
  type: "directory";
  stat: FileStat;
  entries: string[];
};
export type SymlinkContent = {
  type: "symlink";
  stat: FileStat;
  target: string;
};
export type PathContent = FileContent | DirectoryContent | SymlinkContent;

export interface WriteFileOptions extends ScopeOptions {
  uid?: number;
  gid?: number;
  /** Permission bits, e.g. `0o644` */
  mode?: number;
  /** `overwrite` (default) or `append` */
  write?: "overwrite" | "append";
}

export type FileData =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | ReadableStream;

const parseStat = (headers: AxiosResponse["headers"]): FileStat => {
  const modified = headers["x-incus-modified"] as string | undefined;
  const size = headers["content-length"] as string | undefined;
  return {
    type: (headers["x-incus-type"] as FileType | undefined) ?? "file",
    uid: Number(headers["x-incus-uid"] ?? 0),
    gid: Number(headers["x-incus-gid"] ?? 0),
    mode: parseInt((headers["x-incus-mode"] as string | undefined) ?? "0", 8),
    modified: modified
      ? new Date(modified.replace(/ \+0000 UTC$/, "Z"))
      : undefined,
    size: size !== undefined ? Number(size) : undefined,
  };
};

/**
 * File access inside an instance or a custom filesystem volume
 * (`…/files?path=`). Paths are absolute inside the instance/volume.
 */
export class Files extends Resource {
  private readonly url: string;

  constructor(ctx: RequestContext, url: string) {
    super(ctx);
    this.url = url;
  }

  /** Reads a path: file bytes, a directory listing, or a symlink target. */
  async get(path: string, opts?: ScopeOptions): Promise<PathContent> {
    const response = await this.request<ArrayBuffer>("GET", this.url, {
      params: this.scope(opts, { path }),
      responseType: "arraybuffer",
    });
    const stat = parseStat(response.headers);
    if (stat.type === "directory") {
      const body = JSON.parse(
        new TextDecoder().decode(response.data),
      ) as IncusResponse<string[]>;
      const entries = "metadata" in body ? (body.metadata as string[]) : [];
      return { type: "directory", stat, entries: entries ?? [] };
    }
    if (stat.type === "symlink") {
      return {
        type: "symlink",
        stat,
        target: new TextDecoder().decode(response.data).trim(),
      };
    }
    return { type: "file", stat, data: response.data };
  }

  /** Metadata of a path without transferring its content. */
  async stat(path: string, opts?: ScopeOptions): Promise<FileStat> {
    const response = await this.request("HEAD", this.url, {
      params: this.scope(opts, { path }),
    });
    return parseStat(response.headers);
  }

  /** Reads a file's bytes. */
  async read(path: string, opts?: ScopeOptions): Promise<ArrayBuffer> {
    const content = await this.get(path, opts);
    if (content.type !== "file") {
      throw new TypeError(`${path} is a ${content.type}, not a file`);
    }
    return content.data;
  }

  /** Reads a file as UTF-8 text. */
  async readText(path: string, opts?: ScopeOptions): Promise<string> {
    return new TextDecoder().decode(await this.read(path, opts));
  }

  /** Lists the entry names of a directory. */
  async list(path: string, opts?: ScopeOptions): Promise<string[]> {
    const content = await this.get(path, opts);
    if (content.type !== "directory") {
      throw new TypeError(`${path} is a ${content.type}, not a directory`);
    }
    return content.entries;
  }

  /** Creates or replaces a file. */
  async write(
    path: string,
    data: FileData,
    opts?: WriteFileOptions,
  ): Promise<void> {
    await this.post(path, "file", data, opts);
  }

  /** Creates a directory (the parent must exist). */
  async mkdir(
    path: string,
    opts?: Omit<WriteFileOptions, "write">,
  ): Promise<void> {
    await this.post(path, "directory", undefined, opts);
  }

  /** Creates a symlink at `path` pointing to `target`. */
  async symlink(
    path: string,
    target: string,
    opts?: Omit<WriteFileOptions, "write" | "mode">,
  ): Promise<void> {
    await this.post(path, "symlink", target, opts);
  }

  /**
   * Deletes a path. Non-empty directories need `recursive: true`
   * (API extension: `file_delete_force`).
   */
  async delete(
    path: string,
    opts?: ScopeOptions & { recursive?: boolean },
  ): Promise<void> {
    await this.request("DELETE", this.url, {
      params: this.scope(opts, { path }),
      headers: opts?.recursive ? { "X-Incus-force": "true" } : undefined,
    });
  }

  private async post(
    path: string,
    type: FileType,
    data: FileData | undefined,
    opts?: WriteFileOptions,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "X-Incus-type": type,
      "Content-Type": "application/octet-stream",
    };
    if (opts?.uid !== undefined) headers["X-Incus-uid"] = String(opts.uid);
    if (opts?.gid !== undefined) headers["X-Incus-gid"] = String(opts.gid);
    if (opts?.mode !== undefined) {
      headers["X-Incus-mode"] = opts.mode.toString(8).padStart(4, "0");
    }
    if (opts?.write) headers["X-Incus-write"] = opts.write;
    await this.request("POST", this.url, {
      params: this.scope(opts, { path }),
      data: data ?? "",
      headers,
    });
  }
}
