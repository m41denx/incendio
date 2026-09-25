import { Collection } from "./base/collection";
import { Resource } from "./base/request";
import type {
  EtagOptions,
  ListOptions,
  RequestContext,
  ScopeOptions,
  WithEtag,
} from "./base/types";
import type {
  Image,
  ImageAliasesEntry,
  ImageAliasesEntryPut,
  ImageAliasesPost,
  ImageExportPost,
  ImagePut,
  ImagesPost,
  Operation,
} from "./types/generated";
import type { DeepPartial, Input } from "../utils/types";
import { path } from "../utils/path";

/** `/1.0/images/aliases` */
export class ImageAliases extends Collection<
  ImageAliasesEntry,
  Input<ImageAliasesPost, "name" | "target">,
  ImageAliasesEntryPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["images", "aliases"]);
  }

  async rename(
    name: string,
    newName: string,
    opts?: ScopeOptions,
  ): Promise<void> {
    await this.request("POST", this.url(name), {
      params: this.scope(opts),
      data: { name: newName },
    });
  }
}

export interface ImageUploadOptions extends ScopeOptions {
  /** Target filename header (`X-Incus-filename`). */
  filename?: string;
  /** Make the image public. */
  public?: boolean;
  /** Image properties (`X-Incus-properties`). */
  properties?: Record<string, string>;
  /** Aliases to create for the image (`X-Incus-aliases`). */
  aliases?: string[];
}

/** `/1.0/images` — local image store, keyed by fingerprint. */
export class Images extends Resource {
  readonly aliases: ImageAliases;

  constructor(ctx: RequestContext) {
    super(ctx);
    this.aliases = new ImageAliases(ctx);
  }

  async list(opts?: ListOptions): Promise<Image[]> {
    return this.fetchList<Image>(path("images"), this.listScope(opts));
  }

  /** Image fingerprints. */
  async names(opts?: ListOptions): Promise<string[]> {
    return this.fetchNames(path("images"), this.listScope(opts));
  }

  /** Gets an image by (full or unique partial) fingerprint. */
  async get(fingerprint: string, opts?: ScopeOptions): Promise<Image> {
    return this.sync<Image>("GET", path("images", fingerprint), {
      params: this.scope(opts),
    });
  }

  async getWithEtag(
    fingerprint: string,
    opts?: ScopeOptions,
  ): Promise<WithEtag<Image>> {
    return this.syncEtag<Image>(path("images", fingerprint), {
      params: this.scope(opts),
    });
  }

  /** Resolves an alias to its image. */
  async getByAlias(alias: string, opts?: ScopeOptions): Promise<Image> {
    const entry = await this.aliases.get(alias, opts);
    return this.get(entry.target, opts);
  }

  /**
   * Imports an image from a remote server, URL, or an existing instance /
   * snapshot (`source.type` = `image` | `url` | `instance` | `snapshot`).
   */
  async create(
    body: Input<ImagesPost>,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", path("images"), {
      params: this.scope(opts),
      data: body,
    });
  }

  /**
   * Uploads an image tarball (unified, or metadata + rootfs as multipart
   * FormData with `metadata` and `rootfs`/`rootfs.img` parts).
   */
  async upload(
    data: Blob | ArrayBuffer | ArrayBufferView | FormData | ReadableStream,
    opts: ImageUploadOptions = {},
  ): Promise<Operation> {
    const headers: Record<string, string> = {};
    if (!(typeof FormData !== "undefined" && data instanceof FormData)) {
      headers["Content-Type"] = "application/octet-stream";
    }
    if (opts.filename) headers["X-Incus-filename"] = opts.filename;
    if (opts.public) headers["X-Incus-public"] = "true";
    if (opts.properties) {
      headers["X-Incus-properties"] = new URLSearchParams(
        opts.properties,
      ).toString();
    }
    if (opts.aliases?.length) {
      headers["X-Incus-aliases"] = opts.aliases.join(",");
    }
    return this.op("POST", path("images"), {
      params: this.scope(opts),
      data,
      headers,
    });
  }

  async update(
    fingerprint: string,
    body: ImagePut,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request(
      "PUT",
      path("images", fingerprint),
      this.etagOpts(opts, body),
    );
  }

  async patch(
    fingerprint: string,
    body: DeepPartial<ImagePut>,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request(
      "PATCH",
      path("images", fingerprint),
      this.etagOpts(opts, body),
    );
  }

  async delete(fingerprint: string, opts?: ScopeOptions): Promise<Operation> {
    return this.op("DELETE", path("images", fingerprint), {
      params: this.scope(opts),
    });
  }

  /** Downloads the image file(s). Split images come back as multipart. */
  async export(fingerprint: string, opts?: ScopeOptions): Promise<ArrayBuffer> {
    const { data } = await this.request<ArrayBuffer>(
      "GET",
      `${path("images", fingerprint)}/export`,
      { params: this.scope(opts), responseType: "arraybuffer" },
    );
    return data;
  }

  /** Pushes the image to another server (`target` URL + `secret`). */
  async push(
    fingerprint: string,
    body: Input<ImageExportPost, "target">,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", `${path("images", fingerprint)}/export`, {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Refreshes an auto-update image from its source. */
  async refresh(fingerprint: string, opts?: ScopeOptions): Promise<Operation> {
    return this.op("POST", `${path("images", fingerprint)}/refresh`, {
      params: this.scope(opts),
    });
  }

  /** Creates a one-time secret for a private image download by an untrusted client. */
  async createSecret(
    fingerprint: string,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", `${path("images", fingerprint)}/secret`, {
      params: this.scope(opts),
    });
  }
}
