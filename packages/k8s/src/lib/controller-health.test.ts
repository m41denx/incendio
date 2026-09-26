import { describe, expect, it } from "bun:test";
import { staleInspections, type MachineObject } from "./controller-health.ts";

const now = new Date("2026-09-25T20:30:00Z");
const MIN = 5 * 60_000;

// c1's control-plane machine after the host slept (2026-09-25).
const machine = (overrides: Partial<MachineObject> = {}, since = "2026-09-25T20:09:45Z"): MachineObject => ({
  metadata: {
    name: "c1-wlrcr-ws5s6",
    labels: { "cluster.x-k8s.io/cluster-name": "c1", "cluster.x-k8s.io/control-plane": "" },
  },
  status: {
    phase: "Running",
    conditions: [
      { type: "NodeReady", status: "True", reason: "NodeReady", lastTransitionTime: "2026-09-23T20:00:18Z" },
      {
        type: "NodeKubeadmLabelsAndTaintsSet",
        status: "Unknown",
        reason: "InspectionFailed",
        message: "Node c1-wlrcr-ws5s6 is unreachable",
        lastTransitionTime: since,
      },
      {
        type: "APIServerPodHealthy",
        status: "Unknown",
        reason: "InspectionFailed",
        message: "Node c1-wlrcr-ws5s6 is unreachable",
        lastTransitionTime: "2026-09-25T20:09:40Z",
      },
    ],
  },
  ...overrides,
});

describe("staleInspections", () => {
  it("reports a node Cluster API has not reached for a while, once per machine", () => {
    expect(staleInspections({ items: [machine()] }, now, MIN)).toEqual([
      {
        cluster: "c1",
        machine: "c1-wlrcr-ws5s6",
        condition: "APIServerPodHealthy",
        message: "Node c1-wlrcr-ws5s6 is unreachable",
        since: "2026-09-25T20:09:40Z",
      },
    ]);
  });

  it("waits for the condition to settle", () => {
    const fresh = machine();
    for (const c of fresh.status!.conditions!) c.lastTransitionTime = "2026-09-25T20:28:00Z";
    expect(staleInspections({ items: [fresh] }, now, MIN)).toEqual([]);
  });

  it("ignores machines being deleted and other failures", () => {
    const deleting = machine({
      metadata: { ...machine().metadata, deletionTimestamp: "2026-09-25T20:00:00Z" },
    });
    const other = machine();
    for (const c of other.status!.conditions!) c.message = "etcd member not found";
    expect(staleInspections({ items: [deleting, other] }, now, MIN)).toEqual([]);
  });
});
