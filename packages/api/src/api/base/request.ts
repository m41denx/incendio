import type { AxiosInstance, AxiosResponse, Method, ResponseType } from "axios";
import type { Operation } from "../types/generated";
import {
  IncusError,
  type EtagOptions,
  type IncusResponse,
  type ListOptions,
  type RequestContext,
  type ScopeOptions,
  type WithEtag,
} from "./types";
import { nameFromUrl } from "../../utils/path";

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  params?: Record<string, QueryValue>;
  data?: unknown;
  headers?: Record<string, string>;
  responseType?: ResponseType;
  etag?: string;
}

/**
 * Base class for every endpoint group. Holds the shared context and the
 * envelope-unwrapping helpers.
 */
export abstract class Resource {
  protected readonly ctx: RequestContext;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
  }

  /** The underlying axios instance, for requests the SDK doesn't cover. */
  get $r(): AxiosInstance {
    return this.ctx.r;
  }

  /** `project` / `target` query params, falling back to the client defaults. */
  protected scope(
    opts?: ScopeOptions,
    extra?: Record<string, QueryValue>,
  ): Record<string, QueryValue> {
    return {
      project: opts?.project ?? this.ctx.project,
      target: opts?.target ?? this.ctx.target,
      ...extra,
    };
  }

  /** Params for collection GETs: filter + all-projects on top of the scope. */
  protected listScope(
    opts?: ListOptions,
    extra?: Record<string, QueryValue>,
  ): Record<string, QueryValue> {
    const params = this.scope(opts, extra);
    if (opts?.filter) params.filter = opts.filter;
    if (opts?.allProjects) {
      params["all-projects"] = true;
      delete params.project;
    }
    return params;
  }

  protected async request<T>(
    method: Method,
    url: string,
    opts: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    const params = Object.fromEntries(
      Object.entries(opts.params ?? {}).filter(
        ([, v]) => v !== undefined && v !== null && v !== "",
      ),
    );
    const headers = { ...opts.headers };
    if (opts.etag) headers["If-Match"] = opts.etag;
    return this.ctx.r.request<T>({
      method,
      url,
      params,
      data: opts.data,
      headers,
      responseType: opts.responseType,
    });
  }

  /** Performs a request that returns a sync envelope and yields its metadata. */
  protected async sync<T>(
    method: Method,
    url: string,
    opts?: RequestOptions,
  ): Promise<T> {
    const { data } = await this.request<IncusResponse<T>>(method, url, opts);
    return (data as { metadata: T }).metadata;
  }

  /** Like `sync`, but also returns the response ETag for later `If-Match` updates. */
  protected async syncEtag<T>(
    url: string,
    opts?: RequestOptions,
  ): Promise<WithEtag<T>> {
    const response = await this.request<IncusResponse<T>>("GET", url, opts);
    return {
      data: (response.data as { metadata: T }).metadata,
      etag: response.headers.etag as string | undefined,
    };
  }

  /** Performs a request that starts a background operation. */
  protected async op(
    method: Method,
    url: string,
    opts?: RequestOptions,
  ): Promise<Operation> {
    const operation = await this.maybeOp(method, url, opts);
    if (!operation) {
      throw new IncusError(
        `Expected an async response from ${method} ${url}`,
        500,
      );
    }
    return operation;
  }

  /**
   * For endpoints that answer either synchronously or with an operation
   * (e.g. a volume copy). Returns `null` when the work is already done.
   */
  protected async maybeOp(
    method: Method,
    url: string,
    opts?: RequestOptions,
  ): Promise<Operation | null> {
    const { data } = await this.request<IncusResponse>(method, url, opts);
    return data.type === "async" ? data.metadata : null;
  }

  /** GET a collection without recursion and return the entity names. */
  protected async fetchNames(
    url: string,
    params: Record<string, QueryValue>,
  ): Promise<string[]> {
    const urls = await this.sync<string[]>("GET", url, { params });
    return (urls ?? []).map(nameFromUrl);
  }

  /** GET a collection with `recursion=1` (or deeper). */
  protected async fetchList<T>(
    url: string,
    params: Record<string, QueryValue>,
    recursion = 1,
  ): Promise<T[]> {
    const items = await this.sync<T[]>("GET", url, {
      params: { ...params, recursion },
    });
    return items ?? [];
  }

  protected etagOpts(
    opts: EtagOptions | undefined,
    data: unknown,
  ): RequestOptions {
    return { params: this.scope(opts), data, etag: opts?.etag };
  }
}
