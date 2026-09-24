import { describe, expect, it } from "bun:test";
import { eventActivity, logActivity, mergeActivity, parseKlogLine } from "./activity.ts";

// Real controller lines from the appliance (cluster c1).
const KCP_CREATED = `I0923 19:58:50.803931       1 scale.go:52] "Machine default/c1-wlrcr-ws5s6 created (init)" controller="kubeadmcontrolplane" controllerGroup="controlplane.cluster.x-k8s.io" controllerKind="KubeadmControlPlane" KubeadmControlPlane="default/c1-wlrcr" reconcileID="1d345982-b8b8-455e-9c7f-d011ac21ceb9" Cluster="default/c1" machines="c1-wlrcr-ws5s6 (just created)" etcdMembers="" Machine="default/c1-wlrcr-ws5s6" LXCMachine="default/c1-wlrcr-ws5s6" KubeadmConfig="default/c1-wlrcr-ws5s6" desiredReplicas=1 replicas=0`;
const CONNECT_FAILED = `E0923 19:59:25.384824       1 cluster_accessor.go:263] "Connect failed" err="error creating HTTP client and mapper: cluster is not reachable: Get \\"https://10.133.241.59:6443/?timeout=5s\\": context deadline exceeded" controller="clustercache" controllerGroup="cluster.x-k8s.io" controllerKind="Cluster" Cluster="default/c1" reconcileID="a1ae1f8b-ae93-43f6-a7b6-696447f83dab" duration="5.038280616s"`;
const WAITING = `I0923 20:00:21.497476       1 machine_controller_phases.go:315] "Waiting for infrastructure provider to set status.initialization.provisioned on LXCMachine" controller="machine" controllerGroup="cluster.x-k8s.io" controllerKind="Machine" Machine="default/c1-md-0-rnb57-fg6cf-nqv9l" reconcileID="fc664522-258a-41b0-a9c8-4fa0848f8e53" Cluster="default/c1" MachineSet="default/c1-md-0-rnb57-fg6cf" MachineDeployment="default/c1-md-0-rnb57" LXCMachine="default/c1-md-0-rnb57-fg6cf-nqv9l"`;
const NOISE = `I0924 22:03:11.955130       1 kubeadmcontrolplane_controller.go:405] "Reconcile KubeadmControlPlane" controller="kubeadmcontrolplane" controllerGroup="controlplane.cluster.x-k8s.io" controllerKind="KubeadmControlPlane" KubeadmControlPlane="default/c1-wlrcr" reconcileID="f9c7afb2" Cluster="default/c1"`;
const OTHER_CLUSTER = WAITING.replace('Cluster="default/c1"', 'Cluster="default/c10"');

const now = new Date("2026-09-25T12:00:00Z");
const since = new Date("2026-09-23T00:00:00Z");

describe("parseKlogLine", () => {
  it("reads level, time, quoted message and fields", () => {
    const line = parseKlogLine(CONNECT_FAILED, now);
    expect(line?.level).toBe("error");
    expect(line?.time.toISOString()).toBe("2026-09-23T19:59:25.384Z");
    expect(line?.message).toBe("Connect failed");
    expect(line?.fields.Cluster).toBe("default/c1");
    expect(line?.fields.err).toContain('Get "https://10.133.241.59:6443/?timeout=5s"');
  });

  it("puts a December line read in January in the previous year", () => {
    const line = parseKlogLine(
      'I1231 23:59:00.000000       1 x.go:1] "late"',
      new Date("2027-01-01T00:10:00Z"),
    );
    expect(line?.time.toISOString()).toBe("2026-12-31T23:59:00.000Z");
  });

  it("ignores non-klog lines", () => {
    expect(parseKlogLine("W: something else", now)).toBeNull();
  });
});

describe("logActivity", () => {
  const lines = [KCP_CREATED, CONNECT_FAILED, WAITING, NOISE, OTHER_CLUSTER];

  it("keeps this cluster's lines, drops resync noise and other clusters", () => {
    const entries = logActivity(lines, "capi", "default/c1", since, now);
    expect(entries.map((e) => e.message)).toEqual([
      "Machine default/c1-wlrcr-ws5s6 created (init)",
      expect.stringMatching(/^Connect failed: error creating HTTP client/),
      "Waiting for infrastructure provider to set status.initialization.provisioned on LXCMachine",
    ]);
    expect(entries.map((e) => e.object)).toEqual([
      "KubeadmControlPlane/c1-wlrcr",
      "Cluster/c1",
      "Machine/c1-md-0-rnb57-fg6cf-nqv9l",
    ]);
  });

  it("drops lines from before the cluster existed (an older cluster of that name)", () => {
    const later = new Date("2026-09-23T20:00:00Z");
    expect(logActivity(lines, "capi", "default/c1", later, now)).toHaveLength(1);
  });
});

describe("eventActivity", () => {
  const events = {
    items: [
      {
        type: "Normal",
        reason: "SuccessfulSetNodeRef",
        message: "c1-md-0-x",
        involvedObject: { kind: "Machine", name: "c1-md-0-x" },
        lastTimestamp: "2026-09-23T20:00:23Z",
        count: 1,
      },
      {
        type: "Warning",
        reason: "FailedCreate",
        message: "quota",
        involvedObject: { kind: "MachineSet", name: "other-md-0" },
        lastTimestamp: "2026-09-23T20:00:24Z",
      },
      {
        type: "Warning",
        reason: "Unhealthy",
        message: "probe",
        involvedObject: { kind: "Machine", name: "c1-md-0-x" },
        eventTime: "2026-09-23T20:01:00.000000Z",
        series: { count: 4, lastObservedTime: "2026-09-23T20:05:00.000000Z" },
      },
    ],
  };

  it("keeps events on the cluster's objects, with repeat counts", () => {
    const entries = eventActivity(events, new Set(["c1", "c1-md-0-x"]), since);
    expect(entries).toEqual([
      {
        time: "2026-09-23T20:00:23.000Z",
        level: "info",
        source: "event",
        object: "Machine/c1-md-0-x",
        message: "SuccessfulSetNodeRef: c1-md-0-x",
        count: 1,
      },
      {
        time: "2026-09-23T20:05:00.000Z",
        level: "warning",
        source: "event",
        object: "Machine/c1-md-0-x",
        message: "Unhealthy: probe",
        count: 4,
      },
    ]);
  });
});

describe("mergeActivity", () => {
  const entry = (time: string, source: string, message: string) => ({
    time,
    level: "info" as const,
    source,
    object: "Machine/m",
    message,
    count: 1,
  });

  it("orders by time and folds a source's repeats into the first occurrence", () => {
    const merged = mergeActivity(
      [
        [
          entry("2026-09-23T20:00:01Z", "capn", "Creating load balancer"),
          entry("2026-09-23T20:00:02Z", "capn", "Launching load balancer instance"),
          entry("2026-09-23T20:09:01Z", "capn", "Creating load balancer"),
          entry("2026-09-23T20:09:02Z", "capn", "Launching load balancer instance"),
          entry("2026-09-23T20:10:00Z", "capn", "Done"),
        ],
        [entry("2026-09-23T20:00:03Z", "capi", "Creating load balancer")],
      ],
      100,
    );
    expect(merged.map((e) => `${e.source}:${e.message}x${String(e.count)}`)).toEqual([
      "capn:Creating load balancerx2",
      "capn:Launching load balancer instancex2",
      "capi:Creating load balancerx1",
      "capn:Donex1",
    ]);
    expect(merged[0]?.time).toBe("2026-09-23T20:00:01Z");
    expect(merged[0]?.lastTime).toBe("2026-09-23T20:09:01Z");
    expect(merged[2]?.lastTime).toBeUndefined();
  });

  it("keeps events as they are (they count their own repeats)", () => {
    const event = { ...entry("2026-09-23T20:00:01Z", "event", "Unhealthy"), count: 3 };
    const merged = mergeActivity([[event, { ...event, time: "2026-09-23T20:05:00Z" }]], 100);
    expect(merged).toHaveLength(2);
  });

  it("returns the newest `limit` entries", () => {
    const merged = mergeActivity(
      [[entry("2026-09-23T20:00:01Z", "capi", "a"), entry("2026-09-23T20:00:02Z", "capi", "b")]],
      1,
    );
    expect(merged.map((e) => e.message)).toEqual(["b"]);
  });
});
