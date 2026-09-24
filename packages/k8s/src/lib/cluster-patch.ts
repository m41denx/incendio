import { z } from "zod";
import {
  buildScalePatch,
  scaleFields,
  type ClusterObject,
  type JsonPatchOp,
} from "./scale.ts";
import { K8S_VERSION_PATTERN, upgradeError } from "./upgrade.ts";

/**
 * PATCH /v1/clusters/:name — the day-2 edits the agent supports, all of them
 * changes to the Cluster's spec.topology that CAPI then rolls out.
 */
export const ClusterPatchBody = z
  .object({
    ...scaleFields,
    kubernetesVersion: z
      .string()
      .regex(K8S_VERSION_PATTERN, "expected a vX.Y.Z Kubernetes version")
      .optional(),
  })
  .refine(
    (b) =>
      b.controlPlaneCount !== undefined ||
      b.workerCount !== undefined ||
      b.kubernetesVersion !== undefined,
    "set controlPlaneCount, workerCount and/or kubernetesVersion",
  );

export type ClusterPatchRequest = z.infer<typeof ClusterPatchBody>;

/** A request the cluster's current state rules out (HTTP 400, not 502). */
export class PatchRejected extends Error {}

/**
 * JSON patch for a day-2 edit. The version change carries a `test` op on the
 * version it was validated against, so a concurrent upgrade makes the patch
 * fail instead of skipping a minor version.
 */
export function buildClusterPatch(
  cluster: ClusterObject,
  request: ClusterPatchRequest,
): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  if (request.kubernetesVersion !== undefined) {
    const current = cluster.spec?.topology?.version;
    if (!current) throw new PatchRejected("cluster has no topology version to upgrade");
    const error = upgradeError(current, request.kubernetesVersion);
    if (error) throw new PatchRejected(error);
    ops.push(
      { op: "test", path: "/spec/topology/version", value: current },
      {
        op: "replace",
        path: "/spec/topology/version",
        value: request.kubernetesVersion,
      },
    );
  }
  if (request.controlPlaneCount !== undefined || request.workerCount !== undefined) {
    ops.push(
      ...buildScalePatch(cluster, {
        controlPlaneCount: request.controlPlaneCount,
        workerCount: request.workerCount,
      }),
    );
  }
  return ops;
}
