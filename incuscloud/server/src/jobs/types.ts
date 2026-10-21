import type { Db } from "../db/index.ts";
import type { JobProgress, jobs } from "../db/schema.ts";
import type { IncusAdminClient } from "../incus/admin-client.ts";
import type { ClusterRow } from "../clusters/enroll.ts";

export type JobRow = typeof jobs.$inferSelect;

export interface JobContext {
  db: Db;
  secretKey: Buffer;
  job: JobRow;
  /** Aborted when a cancel is requested or the worker stops. */
  signal: AbortSignal;
  progress(p: JobProgress): Promise<void>;
  /** The admin client of an enrolled cluster, with its row. */
  clientFor(clusterId: string): Promise<{ client: IncusAdminClient; row: ClusterRow }>;
}

/** Runs one job; its return value is the job's result. Throwing fails it (or cancels it, once aborted). */
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;
