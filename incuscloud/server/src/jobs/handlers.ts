import { migrateHandler } from "../mobility/migrate-job.ts";
import { failoverHandler, replicateHandler } from "../mobility/replication.ts";
import { backupHandler } from "../backups/backup-job.ts";
import { restoreHandler } from "../backups/restore-job.ts";
import type { JobHandler } from "./types.ts";

/** Every job type the worker runs. */
export function jobHandlers(): Record<string, JobHandler> {
  return { migrate: migrateHandler(), replicate: replicateHandler(), failover: failoverHandler(), backup: backupHandler(), restore: restoreHandler() };
}
