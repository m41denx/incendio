import type { Flavor } from "../constants.ts";

export type ClusterStatus = "pending" | "provisioning" | "ready" | "error";

export interface ClusterRecord {
  id: string;
  name: string;
  flavor: Flavor;
  kubernetesVersion: string;
  controlPlaneCount: number;
  workerCount: number;
  project?: string;
  status: ClusterStatus;
  createdAt: string;
}

/**
 * In-memory placeholder store. Cluster state will ultimately be reconstructed
 * from CAPN resources and `user.incendio.k8s.*` tags on the Incus project
 * (see docs/k8s/README.md); this keeps the API surface exercised until then.
 */
const clusters = new Map<string, ClusterRecord>();

export const clusterStore = {
  list(): ClusterRecord[] {
    return [...clusters.values()];
  },
  get(id: string): ClusterRecord | undefined {
    return clusters.get(id);
  },
  create(record: ClusterRecord): ClusterRecord {
    clusters.set(record.id, record);
    return record;
  },
  delete(id: string): boolean {
    return clusters.delete(id);
  },
};
