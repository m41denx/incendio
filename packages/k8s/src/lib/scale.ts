import { z } from "zod";

/**
 * Scaling a ClusterClass-based cluster = editing replicas in the Cluster's
 * spec.topology; CAPI's topology controller rolls that out to the
 * KubeadmControlPlane / MachineDeployment and CAPN adds or removes Incus
 * instances. Pure helpers so the patch is unit-tested.
 */

export const ScaleBody = z
  .object({
    // Odd only: etcd needs a majority, so 2 or 4 members tolerate no more
    // failures than 1 or 3 while adding a way to lose quorum.
    controlPlaneCount: z
      .number()
      .int()
      .min(1)
      .max(9)
      .refine((n) => n % 2 === 1, "control plane count must be odd (1, 3, 5...)")
      .optional(),
    workerCount: z.number().int().min(0).max(100).optional(),
  })
  .refine(
    (b) => b.controlPlaneCount !== undefined || b.workerCount !== undefined,
    "set controlPlaneCount and/or workerCount",
  );

export type ScaleRequest = z.infer<typeof ScaleBody>;

export interface Topology {
  controlPlane?: { replicas?: number };
  workers?: { machineDeployments?: { name?: string; replicas?: number }[] };
}

export interface ClusterObject {
  spec?: { topology?: Topology };
}

export type JsonPatchOp =
  | { op: "add"; path: string; value: number }
  | { op: "test"; path: string; value: string };

/**
 * JSON patch for the requested counts. `add` also replaces an existing value
 * and works when replicas is unset. Workers scale the first worker group (the
 * template creates exactly one, md-0); a `test` op pins its name so a
 * reordered array fails the patch instead of scaling the wrong group.
 */
export function buildScalePatch(
  cluster: ClusterObject,
  request: ScaleRequest,
): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  if (request.controlPlaneCount !== undefined) {
    ops.push({
      op: "add",
      path: "/spec/topology/controlPlane/replicas",
      value: request.controlPlaneCount,
    });
  }
  if (request.workerCount !== undefined) {
    const group = cluster.spec?.topology?.workers?.machineDeployments?.[0];
    if (!group?.name) {
      throw new Error("cluster has no worker group (machineDeployment) to scale");
    }
    ops.push(
      {
        op: "test",
        path: "/spec/topology/workers/machineDeployments/0/name",
        value: group.name,
      },
      {
        op: "add",
        path: "/spec/topology/workers/machineDeployments/0/replicas",
        value: request.workerCount,
      },
    );
  }
  return ops;
}

/** Desired replicas as CAPI sees them (authoritative over the create-time cache). */
export function desiredCounts(cluster: ClusterObject): {
  controlPlane: number | undefined;
  workers: number | undefined;
} {
  const topology = cluster.spec?.topology;
  const groups = topology?.workers?.machineDeployments;
  return {
    controlPlane: topology?.controlPlane?.replicas,
    workers: groups
      ? groups.reduce((sum, g) => sum + (g.replicas ?? 0), 0)
      : undefined,
  };
}
