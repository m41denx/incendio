import { S3Client } from "bun";
import { randomBytes } from "node:crypto";
import type { backupTargets } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { open } from "../lib/secrets.ts";

export interface PutOptions {
  signal?: AbortSignal;
  /** Bytes stored so far, after each chunk. */
  onBytes?: (n: number) => void;
}

/** Where backup objects live. Every body is a stream: nothing holds a whole backup in memory. */
export interface BlobStore {
  put(key: string, body: ReadableStream<Uint8Array>, opts?: PutOptions): Promise<{ size: number }>;
  /** Throws ApiError(404) when the object is missing. */
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  /** A missing object is fine. */
  delete(key: string): Promise<void>;
  stat(key: string): Promise<{ size: number } | undefined>;
  /** Writes, reads back and removes a small probe object. */
  check(): Promise<void>;
}

const missing = (key: string) => new ApiError(404, "not_found", `Not found in the target: ${key}`);
const aborted = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new Error("aborted"));

/** Reads `body` chunk by chunk, stopping at the signal; `sink` gets each chunk. */
async function drain(body: ReadableStream<Uint8Array>, opts: PutOptions, sink: (chunk: Uint8Array) => Promise<void> | void): Promise<number> {
  const reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      if (opts.signal?.aborted) throw aborted(opts.signal);
      const { done, value } = await reader.read();
      if (done) return size;
      await sink(value);
      size += value.length;
      opts.onBytes?.(size);
    }
  } catch (e) {
    await reader.cancel(e).catch(() => {});
    throw e;
  }
}

async function probe(s: BlobStore): Promise<void> {
  const key = `.incuscloud-probe-${randomBytes(6).toString("hex")}`;
  const body = new TextEncoder().encode("incuscloud");
  await s.put(key, new Blob([body]).stream());
  try {
    let n = 0;
    for await (const c of await s.get(key)) n += c.length;
    if (n !== body.length) throw new ApiError(502, "target_error", "Target: the probe object came back different");
  } finally {
    await s.delete(key);
  }
}

/** In memory, for tests. */
export function memoryStore(): BlobStore & { keys(): string[] } {
  const objects = new Map<string, Buffer>();
  const store: BlobStore & { keys(): string[] } = {
    async put(key, body, opts = {}) {
      const parts: Uint8Array[] = [];
      const size = await drain(body, opts, (c) => void parts.push(c));
      objects.set(key, Buffer.concat(parts));
      return { size };
    },
    async get(key) {
      const b = objects.get(key);
      if (!b) throw missing(key);
      // In chunks, like a real download.
      return new ReadableStream({
        start(c) {
          for (let i = 0; i < b.length; i += 64 * 1024) c.enqueue(new Uint8Array(b.subarray(i, i + 64 * 1024)));
          c.close();
        },
      });
    },
    async delete(key) {
      objects.delete(key);
    },
    async stat(key) {
      const b = objects.get(key);
      return b ? { size: b.length } : undefined;
    },
    check: () => probe(store),
    keys: () => [...objects.keys()],
  };
  return store;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretKey: string;
}

const PART = 8 * 1024 * 1024;
const s3Error = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return new ApiError(502, "target_error", `Target: ${x.code ? `${x.code}: ` : ""}${x.message ?? String(e)}`);
};
const isMissing = (e: unknown) => (e as { code?: string }).code === "NoSuchKey";

/** An S3 bucket (path-style), with Bun's client. */
export function s3Store(cfg: S3Config): BlobStore {
  const client = new S3Client({ endpoint: cfg.endpoint, region: cfg.region || undefined, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretKey });
  const store: BlobStore = {
    async put(key, body, opts = {}) {
      const file = client.file(key);
      const writer = file.writer({ partSize: PART });
      let pending = 0;
      try {
        const size = await drain(body, opts, async (c) => {
          writer.write(c);
          pending += c.length;
          // The writer buffers everything it is given; flushing each part is the backpressure.
          if (pending >= PART) {
            await writer.flush();
            pending = 0;
          }
        });
        await writer.end();
        return { size };
      } catch (e) {
        // Bun's writer cannot abort a multipart upload: finish it, then remove the object.
        await Promise.resolve(writer.end()).catch(() => {});
        await file.delete().catch(() => {});
        throw e instanceof ApiError || opts.signal?.aborted ? e : s3Error(e);
      }
    },
    async get(key) {
      const file = client.file(key);
      try {
        await file.stat();
      } catch (e) {
        throw isMissing(e) ? missing(key) : s3Error(e);
      }
      return file.stream();
    },
    async delete(key) {
      try {
        await client.file(key).delete();
      } catch (e) {
        if (!isMissing(e)) throw s3Error(e);
      }
    },
    async stat(key) {
      try {
        return { size: (await client.file(key).stat()).size };
      } catch (e) {
        if (isMissing(e)) return undefined;
        throw s3Error(e);
      }
    },
    check: () => probe(store),
  };
  return store;
}

type TargetRow = typeof backupTargets.$inferSelect;
export type StoreFor = (target: TargetRow) => BlobStore;

/** The store of a target row: its sealed secret opened with the server key. */
export const s3StoreFor =
  (secretKey: Buffer): StoreFor =>
  (t) =>
    s3Store({ endpoint: t.endpoint, region: t.region, bucket: t.bucket, accessKeyId: t.accessKeyId, secretKey: open(secretKey, t.secretKeyEnc) });

const stamp = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");

/** `<prefix>/<project>/<instance>/<yyyymmddThhmmssZ>-<id8>.tar.gz` */
export function objectKey(o: { prefix: string; project: string; instanceName: string; at: Date; id: string }): string {
  const prefix = o.prefix.replace(/^\/+|\/+$/g, "");
  return `${prefix ? `${prefix}/` : ""}${o.project}/${o.instanceName}/${stamp(o.at)}-${o.id.slice(0, 8)}.tar.gz`;
}
