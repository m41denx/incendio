// Joins a workload cluster's Incus instances with its CAPI machines. CAPN
// stamps every instance it launches with user.cluster-name,
// user.cluster-role (control-plane | worker | loadbalancer) and, for nodes,
// user.machine-name — so Incus alone gives the topology, and the agent's
// machine status adds Kubernetes-level readiness.

import type { LxdInstance } from "types/instance";

/** A CAPI Machine as reported by the agent's /v1/clusters/:name/status. */
export interface K8sMachine {
  name: string;
  role: "control-plane" | "worker";
  phase: string;
  ready: boolean;
  nodeName?: string;
  version?: string;
  address?: string;
  message?: string;
}

export interface ClusterNode {
  name: string;
  instance?: LxdInstance;
  machine?: K8sMachine;
}

export interface ClusterNodes {
  controlPlane: ClusterNode[];
  workers: ClusterNode[];
  loadBalancers: ClusterNode[];
}

const CLUSTER_KEY = "user.cluster-name";
const ROLE_KEY = "user.cluster-role";
const MACHINE_KEY = "user.machine-name";

const byName = (a: ClusterNode, b: ClusterNode): number =>
  a.name.localeCompare(b.name);

export const groupClusterNodes = (
  cluster: string,
  instances: LxdInstance[],
  machines: K8sMachine[],
): ClusterNodes => {
  const machineByName = new Map(machines.map((m) => [m.name, m]));
  const matched = new Set<string>();
  const nodes: ClusterNodes = {
    controlPlane: [],
    workers: [],
    loadBalancers: [],
  };

  for (const instance of instances) {
    // An instance being deleted can be listed with `config: null`.
    const config = (instance.config ?? {}) as Record<
      string,
      string | undefined
    >;
    if (config[CLUSTER_KEY] !== cluster) continue;
    const role = config[ROLE_KEY];
    const machine = machineByName.get(config[MACHINE_KEY] ?? instance.name);
    if (machine) matched.add(machine.name);
    const node = { name: instance.name, instance, machine };
    if (role === "loadbalancer") nodes.loadBalancers.push(node);
    else if ((machine?.role ?? role) === "control-plane")
      nodes.controlPlane.push(node);
    else nodes.workers.push(node);
  }

  // Machines CAPI knows about whose instance is not there (yet).
  for (const machine of machines) {
    if (matched.has(machine.name)) continue;
    const node = { name: machine.name, machine };
    if (machine.role === "control-plane") nodes.controlPlane.push(node);
    else nodes.workers.push(node);
  }

  nodes.controlPlane.sort(byName);
  nodes.workers.sort(byName);
  nodes.loadBalancers.sort(byName);
  return nodes;
};
