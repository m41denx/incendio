import { Resource } from "./base/request";
import type { ListOptions, RequestContext, ScopeOptions } from "./base/types";
import type { Operation } from "./types/generated";
import { path, seg } from "../utils/path";

/**
 * `…/backups` below an instance, storage volume or bucket. Mutations are
 * async operations; the tarball is downloaded from `…/backups/{name}/export`.
 */
export class Backups<T, TCreate> extends Resource {
  private readonly segments: string[];

  constructor(ctx: RequestContext, parent: string[]) {
    super(ctx);
    this.segments = [...parent, "backups"];
  }

  protected url(...entity: string[]): string {
    return path(...this.segments, ...entity);
  }

  async list(opts?: ListOptions): Promise<T[]> {
    return this.fetchList<T>(this.url(), this.listScope(opts));
  }

  async names(opts?: ListOptions): Promise<string[]> {
    return this.fetchNames(this.url(), this.listScope(opts));
  }

  async get(name: string, opts?: ScopeOptions): Promise<T> {
    return this.sync<T>("GET", this.url(name), { params: this.scope(opts) });
  }

  /** Creates a backup; the name is generated when omitted. */
  async create(body: TCreate, opts?: ScopeOptions): Promise<Operation> {
    return this.op("POST", this.url(), {
      params: this.scope(opts),
      data: body ?? {},
    });
  }

  async rename(
    name: string,
    newName: string,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url(name), {
      params: this.scope(opts),
      data: { name: newName },
    });
  }

  async delete(name: string, opts?: ScopeOptions): Promise<Operation> {
    return this.op("DELETE", this.url(name), { params: this.scope(opts) });
  }

  /** Downloads the backup tarball into memory. */
  async export(name: string, opts?: ScopeOptions): Promise<ArrayBuffer> {
    const { data } = await this.request<ArrayBuffer>(
      "GET",
      this.url(name, "export"),
      { params: this.scope(opts), responseType: "arraybuffer" },
    );
    return data;
  }

  /**
   * Download URL of the tarball relative to the API origin, for browser links
   * (`<a href>`) so large backups stream instead of buffering in memory.
   */
  exportUrl(name: string, opts?: ScopeOptions): string {
    const project = opts?.project ?? this.ctx.project;
    const query = project ? `?project=${seg(project)}` : "";
    return `${this.url(name, "export")}${query}`;
  }
}
