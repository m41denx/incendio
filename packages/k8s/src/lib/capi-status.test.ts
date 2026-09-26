import { describe, expect, it } from "bun:test";
import { detectRollout, summarizeLive, type MachineStatus } from "./capi-status.ts";

const CP_LABEL = { "cluster.x-k8s.io/cluster-name": "c1", "cluster.x-k8s.io/control-plane": "" };
const MD_LABEL = { "cluster.x-k8s.io/cluster-name": "c1", "cluster.x-k8s.io/deployment-name": "c1-md-0" };

const machine = (
  name: string,
  labels: Record<string, string>,
  ready: boolean,
  message = "",
) => ({
  metadata: { name, labels },
  spec: { version: "v1.37.0" },
  status: {
    phase: "Running",
    nodeRef: { name },
    addresses: [{ type: "InternalIP", address: "10.0.0.5" }],
    conditions: [
      { type: "Ready", status: ready ? "True" : "False", reason: ready ? "Ready" : "NotReady", message },
    ],
  },
});

const clusters = {
  items: [
    {
      metadata: { name: "c1" },
      spec: {
        controlPlaneEndpoint: { host: "10.133.241.59", port: 6443 },
        topology: {
          controlPlane: { replicas: 3 },
          workers: { machineDeployments: [{ name: "md-0", replicas: 2 }] },
          variables: [
            { name: "secretRef", value: "incendio-c1" },
            { name: "loadBalancer", value: { lxc: { profiles: ["default"] } } },
          ],
        },
      },
      status: {
        phase: "Provisioned",
        conditions: [
          {
            type: "Available",
            status: "False",
            message:
              "* WorkersAvailable:\n  * MachineDeployment c1-md-0: 0 available replicas",
          },
          { type: "Paused", status: "False" },
        ],
      },
    },
  ],
};

describe("summarizeLive", () => {
  it("counts machines by the Ready condition, not phase=Running", () => {
    // Both machines are phase Running (instance up, node joined) but the node
    // is NotReady without a CNI — that must not read as 1/1 ready.
    const live = summarizeLive(clusters, {
      items: [
        machine("c1-cp-a", CP_LABEL, false, "* Node.Ready: cni plugin not initialized"),
        machine("c1-md-0-x", MD_LABEL, false),
      ],
    }).get("c1");
    expect(live?.controlPlaneReady).toBe(0);
    expect(live?.workerReady).toBe(0);
  });

  it("splits ready machines into control plane and workers", () => {
    const live = summarizeLive(clusters, {
      items: [
        machine("c1-cp-a", CP_LABEL, true),
        machine("c1-md-0-x", MD_LABEL, true),
        machine("c1-md-0-y", MD_LABEL, false),
      ],
    }).get("c1");
    expect(live?.controlPlaneReady).toBe(1);
    expect(live?.workerReady).toBe(1);
  });

  it("lists machines with role, readiness, node and reason", () => {
    const live = summarizeLive(clusters, {
      items: [machine("c1-cp-a", CP_LABEL, false, "* Node.Ready: cni plugin not initialized")],
    }).get("c1");
    expect(live?.machines).toEqual([
      {
        name: "c1-cp-a",
        role: "control-plane",
        phase: "Running",
        ready: false,
        nodeName: "c1-cp-a",
        version: "v1.37.0",
        address: "10.0.0.5",
        message: "* Node.Ready: cni plugin not initialized",
      },
    ]);
  });

  it("reports the API endpoint and the Available message", () => {
    const live = summarizeLive(clusters, { items: [] }).get("c1");
    expect(live?.endpoint).toBe("https://10.133.241.59:6443");
    expect(live?.available).toBe(false);
    expect(live?.message).toContain("WorkersAvailable");
    expect(live?.phase).toBe("Provisioned");
  });

  it("brackets an IPv6 endpoint and names the load balancer", () => {
    const v6 = {
      items: [
        {
          ...clusters.items[0],
          spec: { ...clusters.items[0]!.spec, controlPlaneEndpoint: { host: "fd42::5", port: 6443 } },
        },
      ],
    };
    const live = summarizeLive(v6, { items: [] }).get("c1");
    expect(live?.endpoint).toBe("https://[fd42::5]:6443");
    expect(live?.loadBalancer).toBe("lxc");
  });

  it("reports desired counts from the topology", () => {
    const live = summarizeLive(clusters, { items: [] }).get("c1");
    expect(live?.controlPlaneDesired).toBe(3);
    expect(live?.workerDesired).toBe(2);
  });
});

describe("detectRollout", () => {
  const cluster = (conditions: { type: string; status: string }[] = []) => ({
    spec: {
      topology: {
        version: "v1.37.0",
        controlPlane: { replicas: 1 },
        workers: { machineDeployments: [{ name: "md-0", replicas: 1 }] },
      },
    },
    status: { conditions },
  });
  const m = (
    role: MachineStatus["role"],
    over: Partial<MachineStatus> = {},
  ): MachineStatus => ({
    name: `${role}-x`,
    role,
    phase: "Running",
    ready: true,
    version: "v1.37.0",
    ...over,
  });

  it("is quiet when machines match the topology", () => {
    expect(detectRollout(cluster(), [m("control-plane"), m("worker")])).toBeUndefined();
  });

  it("is upgrading while a machine runs another version", () => {
    expect(
      detectRollout(cluster(), [m("control-plane"), m("worker", { version: "v1.36.4" })]),
    ).toBe("upgrading");
  });

  it("is scaling while machine counts differ from the desired replicas", () => {
    expect(detectRollout(cluster(), [m("control-plane")])).toBe("scaling");
  });

  it("is scaling while a new machine is still joining", () => {
    // CAPI's ScalingUp is already False here: the machine exists.
    expect(
      detectRollout(cluster([{ type: "ScalingUp", status: "False" }]), [
        m("control-plane"),
        m("worker", { phase: "Provisioned", ready: false }),
      ]),
    ).toBe("scaling");
  });

  it("follows CAPI's ScalingDown condition", () => {
    expect(
      detectRollout(cluster([{ type: "ScalingDown", status: "True" }]), [
        m("control-plane"),
        m("worker"),
      ]),
    ).toBe("scaling");
  });

  it("does not call a joined but NotReady node a rollout", () => {
    expect(
      detectRollout(cluster(), [m("control-plane"), m("worker", { ready: false })]),
    ).toBeUndefined();
  });
});
