import { migrateHandler } from "../mobility/migrate-job.ts";
import { failoverHandler, replicateHandler } from "../mobility/replication.ts";
import { backupHandler } from "../backups/backup-job.ts";
import { restoreHandler } from "../backups/restore-job.ts";
import { evacuateHandler, rebalanceHandler, restoreMemberHandler } from "../balancing/jobs.ts";
import { createHandler } from "../tenants/create-job.ts";
import { k8sCreateHandler, k8sDeleteHandler, k8sMetallbHandler } from "../k8s/jobs.ts";
import type { Kube } from "../k8s/kube.ts";
import type { JobHandler } from "./types.ts";

/** Every job type the worker runs; the Kubernetes ones only with a management cluster. */
export function jobHandlers(opts: { imageServer?: string; kube?: Kube; metallbManifestUrl?: string } = {}): Record<string, JobHandler> {
  const { kube } = opts;
  return {
    ...(kube
      ? {
          "k8s-create": k8sCreateHandler({ kube }),
          "k8s-delete": k8sDeleteHandler({ kube }),
          "k8s-metallb": k8sMetallbHandler({ kube, metallbManifest: opts.metallbManifestUrl ? () => fetch(opts.metallbManifestUrl!, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`MetalLB's manifest: HTTP ${r.status}`)))) : undefined }),
        }
      : {}),
    migrate: migrateHandler(),
    replicate: replicateHandler(),
    failover: failoverHandler(),
    backup: backupHandler(),
    restore: restoreHandler(),
    rebalance: rebalanceHandler(),
    evacuate: evacuateHandler(),
    "restore-member": restoreMemberHandler(),
    create: createHandler(opts),
  };
}
