import { Backups } from "./backups";
import { Collection, EntityCollection } from "./base/collection";
import { Resource } from "./base/request";
import type {
  EtagOptions,
  ListOptions,
  RequestContext,
  ScopeOptions,
  WithEtag,
} from "./base/types";
import { Files } from "./files";
import type {
  Operation,
  ResourcesStoragePool,
  StorageBucket,
  StorageBucketBackup,
  StorageBucketBackupsPost,
  StorageBucketKey,
  StorageBucketKeyPut,
  StorageBucketKeysPost,
  StorageBucketPut,
  StorageBucketsPost,
  StoragePool,
  StoragePoolPut,
  StoragePoolsPost,
  StorageVolume,
  StorageVolumeBackup,
  StorageVolumeBackupsPost,
  StorageVolumeBitmap,
  StorageVolumeBitmapsPost,
  StorageVolumeFull,
  StorageVolumePost,
  StorageVolumePut,
  StorageVolumeRebuildPost,
  StorageVolumeSnapshot,
  StorageVolumeSnapshotPut,
  StorageVolumeSnapshotsPost,
  StorageVolumeState,
  StorageVolumesPost,
} from "./types/generated";
import type { DeepPartial, Input } from "../utils/types";
import { path } from "../utils/path";

/** `custom` volumes are user-created; the others back instances and images. */
export type StorageVolumeType =
  | "custom"
  | "container"
  | "virtual-machine"
  | "image";

/** `/1.0/storage-pools` */
export class StoragePools extends Collection<
  StoragePool,
  Input<StoragePoolsPost, "name" | "driver">,
  StoragePoolPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["storage-pools"]);
  }

  /** Space and inode usage of the pool. */
  async resources(
    name: string,
    opts?: ScopeOptions,
  ): Promise<ResourcesStoragePool> {
    return this.sync<ResourcesStoragePool>("GET", this.url(name, "resources"), {
      params: this.scope(opts),
    });
  }
}

/** `/1.0/storage-pools/{pool}/volumes/{type}/{volume}/snapshots` */
export class StorageVolumeSnapshots extends Resource {
  private readonly volume: string[];

  constructor(ctx: RequestContext, volume: string[]) {
    super(ctx);
    this.volume = volume;
  }

  private url(...snapshot: string[]): string {
    return path(...this.volume, "snapshots", ...snapshot);
  }

  async list(opts?: ListOptions): Promise<StorageVolumeSnapshot[]> {
    return this.fetchList<StorageVolumeSnapshot>(
      this.url(),
      this.listScope(opts),
    );
  }

  async names(opts?: ListOptions): Promise<string[]> {
    return this.fetchNames(this.url(), this.listScope(opts));
  }

  async get(name: string, opts?: ScopeOptions): Promise<StorageVolumeSnapshot> {
    return this.sync<StorageVolumeSnapshot>("GET", this.url(name), {
      params: this.scope(opts),
    });
  }

  async getWithEtag(
    name: string,
    opts?: ScopeOptions,
  ): Promise<WithEtag<StorageVolumeSnapshot>> {
    return this.syncEtag<StorageVolumeSnapshot>(this.url(name), {
      params: this.scope(opts),
    });
  }

  /** Creates a snapshot; the name is generated when omitted. */
  async create(
    body: Input<StorageVolumeSnapshotsPost> = {},
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url(), {
      params: this.scope(opts),
      data: body,
    });
  }

  async update(
    name: string,
    body: StorageVolumeSnapshotPut,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request("PUT", this.url(name), this.etagOpts(opts, body));
  }

  async patch(
    name: string,
    body: DeepPartial<StorageVolumeSnapshotPut>,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request("PATCH", this.url(name), this.etagOpts(opts, body));
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

  /** Restores the volume to this snapshot. */
  async restore(name: string, opts?: ScopeOptions): Promise<void> {
    await this.request("PATCH", path(...this.volume), {
      params: this.scope(opts),
      data: { restore: name },
    });
  }
}

/** `/1.0/storage-pools/{pool}/volumes/{type}/{volume}/bitmaps` (API extension: `storage_volume_bitmaps`) */
export class StorageVolumeBitmaps extends Collection<
  StorageVolumeBitmap,
  Input<StorageVolumeBitmapsPost, "name">,
  never
> {
  constructor(ctx: RequestContext, volume: string[]) {
    super(ctx, [...volume, "bitmaps"]);
  }
}

/** `/1.0/storage-pools/{pool}/volumes` — collection-level volume operations. */
export class StorageVolumes extends Resource {
  private readonly pool: string;

  constructor(ctx: RequestContext, pool: string) {
    super(ctx);
    this.pool = pool;
  }

  private url(type?: StorageVolumeType): string {
    return type
      ? path("storage-pools", this.pool, "volumes", type)
      : path("storage-pools", this.pool, "volumes");
  }

  /** Lists volumes, optionally of one type. */
  async list(
    opts?: ListOptions & { type?: StorageVolumeType },
  ): Promise<StorageVolume[]> {
    return this.fetchList<StorageVolume>(
      this.url(opts?.type),
      this.listScope(opts),
    );
  }

  /** Lists volumes with their state and snapshots (`recursion=2`, API extension: `storage_volume_full`). */
  async listFull(
    opts?: ListOptions & { type?: StorageVolumeType },
  ): Promise<StorageVolumeFull[]> {
    return this.fetchList<StorageVolumeFull>(
      this.url(opts?.type ?? "custom"),
      this.listScope(opts),
      2,
    );
  }

  /** Volume names of one type (default `custom`). */
  async names(
    opts?: ListOptions & { type?: StorageVolumeType },
  ): Promise<string[]> {
    return this.fetchNames(
      this.url(opts?.type ?? "custom"),
      this.listScope(opts),
    );
  }

  /**
   * Creates a volume (default type `custom`). Copies (`source.type: "copy"`)
   * run as an operation; plain creates complete synchronously (→ `null`).
   */
  async create(
    body: Input<StorageVolumesPost, "name">,
    opts?: ScopeOptions,
  ): Promise<Operation | null> {
    return this.maybeOp(
      "POST",
      this.url((body.type as StorageVolumeType) ?? "custom"),
      {
        params: this.scope(opts),
        data: { type: "custom", ...body },
      },
    );
  }

  /**
   * Imports a custom volume from a backup tarball, or an ISO file
   * (`kind: "iso"`, API extension: `custom_volume_iso`).
   */
  async import(
    name: string,
    data: Blob | ArrayBuffer | ArrayBufferView | ReadableStream,
    opts: ScopeOptions & { kind?: "backup" | "iso" } = {},
  ): Promise<Operation> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "X-Incus-name": name,
    };
    if (opts.kind === "iso") headers["X-Incus-type"] = "iso";
    return this.op("POST", this.url("custom"), {
      params: this.scope(opts),
      data,
      headers,
    });
  }
}

/** `/1.0/storage-pools/{pool}/volumes/{type}/{name}` — one volume and its sub-resources. */
export class StorageVolumeClient extends Resource {
  readonly pool: string;
  readonly type: StorageVolumeType;
  readonly name: string;
  readonly snapshots: StorageVolumeSnapshots;
  readonly backups: Backups<
    StorageVolumeBackup,
    Input<StorageVolumeBackupsPost> | void
  >;
  readonly bitmaps: StorageVolumeBitmaps;
  /** Files in a custom filesystem volume (API extension: `file_storage_volume`). */
  readonly files: Files;

  constructor(
    ctx: RequestContext,
    pool: string,
    name: string,
    type: StorageVolumeType = "custom",
  ) {
    super(ctx);
    this.pool = pool;
    this.type = type;
    this.name = name;
    const segments = ["storage-pools", pool, "volumes", type, name];
    this.snapshots = new StorageVolumeSnapshots(ctx, segments);
    this.backups = new Backups(ctx, segments);
    this.bitmaps = new StorageVolumeBitmaps(ctx, segments);
    this.files = new Files(ctx, path(...segments, "files"));
  }

  private url(...segments: string[]): string {
    return path(
      "storage-pools",
      this.pool,
      "volumes",
      this.type,
      this.name,
      ...segments,
    );
  }

  async get(opts?: ScopeOptions): Promise<StorageVolume> {
    return this.sync<StorageVolume>("GET", this.url(), {
      params: this.scope(opts),
    });
  }

  async getWithEtag(opts?: ScopeOptions): Promise<WithEtag<StorageVolume>> {
    return this.syncEtag<StorageVolume>(this.url(), {
      params: this.scope(opts),
    });
  }

  async update(body: StorageVolumePut, opts?: EtagOptions): Promise<void> {
    await this.request("PUT", this.url(), this.etagOpts(opts, body));
  }

  async patch(
    body: DeepPartial<StorageVolumePut>,
    opts?: EtagOptions,
  ): Promise<void> {
    await this.request("PATCH", this.url(), this.etagOpts(opts, body));
  }

  async delete(opts?: ScopeOptions): Promise<void> {
    await this.request("DELETE", this.url(), { params: this.scope(opts) });
  }

  /** Renames the volume (sync) — see `move` for other pools/projects. */
  async rename(
    newName: string,
    opts?: ScopeOptions,
  ): Promise<Operation | null> {
    return this.maybeOp("POST", this.url(), {
      params: this.scope(opts),
      data: { name: newName },
    });
  }

  /** Moves/renames the volume to another pool, project or cluster member. */
  async move(
    body: Input<StorageVolumePost, "name">,
    opts?: ScopeOptions,
  ): Promise<Operation | null> {
    return this.maybeOp("POST", this.url(), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Usage (bytes/inodes) of the volume. */
  async state(opts?: ScopeOptions): Promise<StorageVolumeState> {
    return this.sync<StorageVolumeState>("GET", this.url("state"), {
      params: this.scope(opts),
    });
  }

  /** Wipes the volume, optionally re-populating it (API extension: `custom_volume_rebuild`). */
  async rebuild(
    body: Input<StorageVolumeRebuildPost> = {},
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url("rebuild"), {
      params: this.scope(opts),
      data: body,
    });
  }
}

/** `/1.0/storage-pools/{pool}/buckets/{bucket}/keys` */
export class StorageBucketKeys extends EntityCollection<
  StorageBucketKey,
  StorageBucketKeyPut
> {
  constructor(ctx: RequestContext, pool: string, bucket: string) {
    super(ctx, ["storage-pools", pool, "buckets", bucket, "keys"]);
  }

  /** Creates a key; the response includes the generated credentials. */
  async create(
    body: Input<StorageBucketKeysPost, "name">,
    opts?: ScopeOptions,
  ): Promise<StorageBucketKey> {
    return this.sync<StorageBucketKey>("POST", this.url(), {
      params: this.scope(opts),
      data: body,
    });
  }
}

/** `/1.0/storage-pools/{pool}/buckets` (API extension: `storage_buckets`) */
export class StorageBuckets extends EntityCollection<
  StorageBucket,
  StorageBucketPut
> {
  private readonly pool: string;

  constructor(ctx: RequestContext, pool: string) {
    super(ctx, ["storage-pools", pool, "buckets"]);
    this.pool = pool;
  }

  /** Creates a bucket and returns its generated `admin` key. */
  async create(
    body: Input<StorageBucketsPost, "name">,
    opts?: ScopeOptions,
  ): Promise<StorageBucketKey> {
    return this.sync<StorageBucketKey>("POST", this.url(), {
      params: this.scope(opts),
      data: body,
    });
  }

  /** Imports a bucket from a backup tarball (API extension: `storage_bucket_backup`). */
  async import(
    name: string,
    data: Blob | ArrayBuffer | ArrayBufferView | ReadableStream,
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url(), {
      params: this.scope(opts),
      data,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Incus-name": name,
      },
    });
  }

  /** Access keys of one bucket. */
  keys(bucket: string): StorageBucketKeys {
    return new StorageBucketKeys(this.ctx, this.pool, bucket);
  }

  /** Backups of one bucket. */
  backups(
    bucket: string,
  ): Backups<StorageBucketBackup, Input<StorageBucketBackupsPost> | void> {
    return new Backups(this.ctx, [
      "storage-pools",
      this.pool,
      "buckets",
      bucket,
    ]);
  }
}

/** `/1.0/storage-pools/{name}` — one pool's volumes and buckets. */
export class StoragePoolClient extends Resource {
  readonly name: string;
  readonly volumes: StorageVolumes;
  readonly buckets: StorageBuckets;

  constructor(ctx: RequestContext, name: string) {
    super(ctx);
    this.name = name;
    this.volumes = new StorageVolumes(ctx, name);
    this.buckets = new StorageBuckets(ctx, name);
  }

  /** One volume (default type `custom`). */
  volume(
    name: string,
    type: StorageVolumeType = "custom",
  ): StorageVolumeClient {
    return new StorageVolumeClient(this.ctx, this.name, name, type);
  }
}
