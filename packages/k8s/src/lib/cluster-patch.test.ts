import { describe, expect, it } from "bun:test";
import { buildClusterPatch, ClusterPatchBody, PatchRejected } from "./cluster-patch.ts";

const cluster = {
  spec: {
    topology: {
      version: "v1.36.4",
      controlPlane: { replicas: 1 },
      workers: { machineDeployments: [{ name: "md-0", replicas: 1 }] },
    },
  },
};

describe("ClusterPatchBody", () => {
  it("accepts a version, replicas, or both", () => {
    expect(ClusterPatchBody.safeParse({ kubernetesVersion: "v1.37.0" }).success).toBe(true);
    expect(ClusterPatchBody.safeParse({ workerCount: 2 }).success).toBe(true);
    expect(
      ClusterPatchBody.safeParse({ kubernetesVersion: "v1.37.0", workerCount: 2 }).success,
    ).toBe(true);
  });

  it("rejects an empty body, bad versions and even control planes", () => {
    expect(ClusterPatchBody.safeParse({}).success).toBe(false);
    expect(ClusterPatchBody.safeParse({ kubernetesVersion: "latest" }).success).toBe(false);
    expect(ClusterPatchBody.safeParse({ controlPlaneCount: 2 }).success).toBe(false);
  });
});

describe("buildClusterPatch", () => {
  it("pins the validated version with a test op before replacing it", () => {
    expect(buildClusterPatch(cluster, { kubernetesVersion: "v1.37.0" })).toEqual([
      { op: "test", path: "/spec/topology/version", value: "v1.36.4" },
      { op: "replace", path: "/spec/topology/version", value: "v1.37.0" },
    ]);
  });

  it("combines an upgrade with scaling", () => {
    const ops = buildClusterPatch(cluster, { kubernetesVersion: "v1.37.0", workerCount: 3 });
    expect(ops.map((o) => o.path)).toEqual([
      "/spec/topology/version",
      "/spec/topology/version",
      "/spec/topology/workers/machineDeployments/0/name",
      "/spec/topology/workers/machineDeployments/0/replicas",
    ]);
  });

  it("rejects an upgrade the current version rules out", () => {
    expect(() => buildClusterPatch(cluster, { kubernetesVersion: "v1.38.0" })).toThrow(
      PatchRejected,
    );
    expect(() => buildClusterPatch({ spec: {} }, { kubernetesVersion: "v1.37.0" })).toThrow(
      /no topology version/,
    );
  });
});
