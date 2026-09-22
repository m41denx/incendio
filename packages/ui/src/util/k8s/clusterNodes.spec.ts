import { groupClusterNodes, type K8sMachine } from "./clusterNodes";
import type { LxdInstance } from "types/instance";

const instance = (
  name: string,
  config: Record<string, string>,
  status = "Running",
): LxdInstance =>
  ({ name, status, project: "k8s-c1", config }) as unknown as LxdInstance;

const capn = (cluster: string, role: string, machine?: string) => ({
  "user.cluster-name": cluster,
  "user.cluster-role": role,
  ...(machine ? { "user.machine-name": machine } : {}),
});

const machine = (
  name: string,
  role: K8sMachine["role"],
  ready = true,
): K8sMachine => ({ name, role, phase: "Running", ready });

describe("groupClusterNodes", () => {
  // The real shape CAPN produces: haproxy LB + one node per role.
  const instances = [
    instance("c1-8kgl9-lb", capn("c1", "loadbalancer")),
    instance("c1-ljt4d-nm8rm", capn("c1", "control-plane", "c1-ljt4d-nm8rm")),
    instance("c1-md-0-tndx7", capn("c1", "worker", "c1-md-0-tndx7")),
    instance("other-cp", capn("c2", "control-plane", "other-cp")),
    instance("unrelated", {}),
  ];
  const machines = [
    machine("c1-ljt4d-nm8rm", "control-plane"),
    machine("c1-md-0-tndx7", "worker", false),
  ];

  it("splits the cluster's instances by CAPN role", () => {
    const nodes = groupClusterNodes("c1", instances, machines);
    expect(nodes.controlPlane.map((n) => n.name)).toEqual(["c1-ljt4d-nm8rm"]);
    expect(nodes.workers.map((n) => n.name)).toEqual(["c1-md-0-tndx7"]);
    expect(nodes.loadBalancers.map((n) => n.name)).toEqual(["c1-8kgl9-lb"]);
  });

  it("joins each instance with its CAPI machine", () => {
    const nodes = groupClusterNodes("c1", instances, machines);
    expect(nodes.controlPlane[0].machine?.ready).toBe(true);
    expect(nodes.workers[0].machine?.ready).toBe(false);
    expect(nodes.workers[0].instance?.name).toBe("c1-md-0-tndx7");
    expect(nodes.loadBalancers[0].machine).toBeUndefined();
  });

  it("ignores other clusters' and unrelated instances", () => {
    const nodes = groupClusterNodes("c1", instances, machines);
    const all = [
      ...nodes.controlPlane,
      ...nodes.workers,
      ...nodes.loadBalancers,
    ];
    expect(all.map((n) => n.name)).not.toContain("other-cp");
    expect(all.map((n) => n.name)).not.toContain("unrelated");
  });

  it("keeps machines whose instance does not exist yet", () => {
    const nodes = groupClusterNodes(
      "c1",
      [],
      [machine("c1-md-0-new", "worker", false)],
    );
    expect(nodes.workers).toHaveLength(1);
    expect(nodes.workers[0].instance).toBeUndefined();
    expect(nodes.workers[0].machine?.name).toBe("c1-md-0-new");
  });

  it("falls back to the instance name when user.machine-name is absent", () => {
    const nodes = groupClusterNodes(
      "c1",
      [instance("c1-cp-x", capn("c1", "control-plane"))],
      [machine("c1-cp-x", "control-plane")],
    );
    expect(nodes.controlPlane).toHaveLength(1);
    expect(nodes.controlPlane[0].machine?.name).toBe("c1-cp-x");
  });
});
