import type { DeepPartial } from "../../utils/types";
import { path } from "../../utils/path";
import { Resource } from "./request";
import type {
  EtagOptions,
  ListOptions,
  RequestContext,
  ScopeOptions,
  WithEtag,
} from "./types";

/**
 * Read/update/delete over a named collection whose mutations are synchronous
 * — the shape shared by profiles, networks, ACLs, zones, forwards, pools, …
 *
 * @typeParam T    entity returned by GET
 * @typeParam TPut body for PUT/PATCH on an entity
 */
export abstract class EntityCollection<T, TPut> extends Resource {
  /** Path segments of the collection below `/1.0`. */
  protected readonly segments: string[];

  constructor(ctx: RequestContext, segments: string[]) {
    super(ctx);
    this.segments = segments;
  }

  protected url(...entity: string[]): string {
    return path(...this.segments, ...entity);
  }

  /** Lists entities with full details (`recursion=1`). */
  async list(opts?: ListOptions): Promise<T[]> {
    return this.fetchList<T>(this.url(), this.listScope(opts));
  }

  /** Lists entity names only (no recursion). */
  async names(opts?: ListOptions): Promise<string[]> {
    return this.fetchNames(this.url(), this.listScope(opts));
  }

  async get(name: string, opts?: ScopeOptions): Promise<T> {
    return this.sync<T>("GET", this.url(name), { params: this.scope(opts) });
  }

  /** GET with the ETag, for a conflict-safe `update(name, body, {etag})`. */
  async getWithEtag(name: string, opts?: ScopeOptions): Promise<WithEtag<T>> {
    return this.syncEtag<T>(this.url(name), { params: this.scope(opts) });
  }

  /** Replaces the entity's writable fields (PUT). Omitted fields are reset. */
  async update(name: string, body: TPut, opts?: EtagOptions): Promise<void> {
    await this.request("PUT", this.url(name), this.etagOpts(opts, body));
  }

  /** Merges the given fields into the entity (PATCH). */
  async patch(
    name: string,
    body: DeepPartial<TPut>,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request("PATCH", this.url(name), this.etagOpts(opts, body));
  }

  async delete(name: string, opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", this.url(name), {
      params: this.scope(opts),
    });
  }

  /** Whether an entity with this name exists. */
  async exists(name: string, opts?: ScopeOptions): Promise<boolean> {
    try {
      await this.get(name, opts);
      return true;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return false;
      throw error;
    }
  }
}

/**
 * A collection created with a synchronous `POST` on the collection URL.
 *
 * @typeParam TCreate body for POST on the collection
 */
export abstract class Collection<T, TCreate, TPut> extends EntityCollection<
  T,
  TPut
> {
  async create(body: TCreate, opts?: ScopeOptions): Promise<void> {
    await this.request("POST", this.url(), {
      params: this.scope(opts),
      data: body,
    });
  }
}

/** A collection whose entities can be renamed with `POST {name}`. */
export abstract class RenamableCollection<T, TCreate, TPut> extends Collection<
  T,
  TCreate,
  TPut
> {
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
