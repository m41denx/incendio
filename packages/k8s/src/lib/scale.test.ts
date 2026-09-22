import { describe, expect, it } from "bun:test";
import { buildScalePatch, desiredCounts, ScaleBody } from "./scale.ts";

// Shape of `kubectl get cluster c1 -o json` for the CAPN ClusterClass template.
const cluster = {
  spec: {
    topology: {
      controlPlane: { replicas: 1 },
      workers: {
        machineDeployments: [
          { class: "default-worker", name: "md-0", replicas: 1 },
        ],
      },
    },
  },
};

describe("ScaleBody", () => {
  it("accepts odd control-plane counts (etcd quorum)", () => {
    expect(ScaleBody.safeParse({ controlPlaneCount: 3 }).success).toBe(true);
    expect(ScaleBody.safeParse({ controlPlaneCount: 2 }).success).toBe(false);
  });

  it("allows scaling workers to zero", () => {
    expect(ScaleBody.safeParse({ workerCount: 0 }).success).toBe(true);
  });

  it("requires at least one count", () => {
    expect(ScaleBody.safeParse({}).success).toBe(false);
  });
});

describe("buildScalePatch", () => {
  it("patches control-plane and worker replicas in the topology", () => {
    expect(buildScalePatch(cluster, { controlPlaneCount: 3, workerCount: 4 })).toEqual([
      { op: "add", path: "/spec/topology/controlPlane/replicas", value: 3 },
      {
        op: "test",
        path: "/spec/topology/workers/machineDeployments/0/name",
        value: "md-0",
      },
      {
        op: "add",
        path: "/spec/topology/workers/machineDeployments/0/replicas",
        value: 4,
      },
    ]);
  });

  it("only touches what was asked", () => {
    expect(buildScalePatch(cluster, { workerCount: 2 })).toHaveLength(2);
    expect(buildScalePatch(cluster, { controlPlaneCount: 5 })).toEqual([
      { op: "add", path: "/spec/topology/controlPlane/replicas", value: 5 },
    ]);
  });

  it("refuses when the cluster has no worker group to scale", () => {
    expect(() =>
      buildScalePatch({ spec: { topology: { controlPlane: { replicas: 1 } } } }, {
        workerCount: 2,
      }),
    ).toThrow(/worker/i);
  });
});

describe("desiredCounts", () => {
  it("reads desired replicas from the topology", () => {
    expect(desiredCounts(cluster)).toEqual({ controlPlane: 1, workers: 1 });
  });

  it("sums replicas across worker groups", () => {
    const two = structuredClone(cluster);
    two.spec.topology.workers.machineDeployments.push({
      class: "default-worker",
      name: "md-1",
      replicas: 2,
    });
    expect(desiredCounts(two).workers).toBe(3);
  });

  it("is undefined without a topology (non-ClusterClass cluster)", () => {
    expect(desiredCounts({ spec: {} })).toEqual({
      controlPlane: undefined,
      workers: undefined,
    });
  });
});
