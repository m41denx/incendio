import { isIP } from "node:net";
import { parseRange } from "@incendio/k8s/src/lib/metallb";
import type { Usage } from "../tenants/quota.ts";

const GiB = 1024 ** 3;

/** Versions with prebuilt CAPN kubeadm images (amd64 and arm64 containers), oldest first. */
export const KUBERNETES_VERSIONS = ["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"] as const;

/** Node sizes: CAPN flavors are Incus instance types (`c<cpus>-m<GiB>`). kubeadm needs 2 CPUs on a control plane. */
export const SIZES = {
  small: { cpu: 2, memoryGiB: 2, flavor: "c2-m2" },
  medium: { cpu: 2, memoryGiB: 4, flavor: "c2-m4" },
  large: { cpu: 4, memoryGiB: 8, flavor: "c4-m8" },
} as const;
export type Size = keyof typeof SIZES;

/** CAPN's haproxy load balancer in front of the control planes. */
export const LB = { cpu: 1, memoryGiB: 1, flavor: "c1-m1" } as const;
/** Every instance gets the project's default root disk (10 GiB, P3). */
export const NODE_DISK = 10 * GiB;

/** The ClusterClass new clusters get (clusterclass.yaml says why there are versions). */
export const CLASS_NAME = "incuscloud-v2";
export const CLASS_NAMESPACE = "incuscloud-system";
export const namespaceOf = (slug: string) => `ic-${slug}`;

/** What a cluster (or, with `lb: false`, added nodes) counts against the tenant's quota. */
export function usageOf(size: Size, controlPlanes: number, workers: number, opts: { lb?: boolean } = {}): Usage {
  const s = SIZES[size];
  const nodes = controlPlanes + workers;
  const lb = opts.lb === false ? 0 : 1;
  return {
    instances: nodes + lb,
    cpu: nodes * s.cpu + lb * LB.cpu,
    memory: (nodes * s.memoryGiB + lb * LB.memoryGiB) * GiB,
    disk: (nodes + lb) * NODE_DISK,
  };
}

const minorOf = (v: string) => Number(/^v1\.(\d+)\./.exec(v)?.[1] ?? NaN);

/** Why `from` cannot become `to`, or null: one minor version forward at most, to an offered version. */
export function upgradeError(from: string, to: string): string | null {
  if (!(KUBERNETES_VERSIONS as readonly string[]).includes(to)) return `${to} is not offered; choose one of ${KUBERNETES_VERSIONS.join(", ")}`;
  const [a, b] = [minorOf(from), minorOf(to)];
  if (b < a || (b === a && to < from)) return `Kubernetes cannot be downgraded (${from} to ${to})`;
  if (b > a + 1) return `Upgrade one minor version at a time: ${from} can go to v1.${a + 1} next`;
  return null;
}

export type MachineType = "container" | "virtual-machine";
/** One role's instances: `flavor` is CAPN's `c<cores>-m<GiB>`; `target` a member, `@group` or "" (anywhere). */
export interface MachineSpec {
  type: MachineType;
  flavor: string;
  profiles: string[];
  target: string;
}
/** CAPN's load balancer in front of the control planes: an instance (lxc, oci), or an address (kube-vip, OVN). */
export type LbSpec =
  | { type: "lxc" | "oci"; flavor: string; profiles: string[]; target: string }
  | { type: "kube-vip"; host: string; interface: string }
  | { type: "ovn"; host: string; networkName: string };
/** Everything Incendio's create form sets, beyond name, version and counts. */
export interface K8sSpec {
  controlPlane: MachineSpec;
  worker: MachineSpec;
  loadBalancer: LbSpec;
  /** "" = CAPN's image for the version. */
  image: string;
  privileged: boolean;
  flannel: boolean;
  installKubeadm: boolean;
  podCidr: string;
  serviceCidr: string;
  metallb: { addresses: string[] } | null;
}

export const DEFAULT_POD_CIDR = "10.244.0.0/16";
export const DEFAULT_SERVICE_CIDR = "10.96.0.0/12";
/** kubeadm's floor for a control plane (as Incendio checks). */
const CP_MIN_CPU = 2;
const CP_MIN_MEMORY_MIB = 1700;

/** CPU and memory of a `c<cores>-m<GiB>` flavor, or null. */
export function parseFlavor(f: string): { cpu: number; memoryGiB: number } | null {
  const m = /^c(\d+)-m(\d+(?:\.\d+)?)$/.exec(f.trim());
  if (!m) return null;
  const cpu = Number(m[1]);
  const memoryGiB = Number(m[2]);
  return cpu > 0 && memoryGiB > 0 ? { cpu, memoryGiB } : null;
}

/** A size as a spec: what clusters made before specs were. */
export function specFromSize(size: Size, member = ""): K8sSpec {
  const machine: MachineSpec = { type: "container", flavor: SIZES[size].flavor, profiles: ["default"], target: member };
  return {
    controlPlane: machine,
    worker: { ...machine },
    loadBalancer: { type: "lxc", flavor: LB.flavor, profiles: ["default"], target: member },
    image: "",
    privileged: false,
    flannel: true,
    installKubeadm: false,
    podCidr: DEFAULT_POD_CIDR,
    serviceCidr: DEFAULT_SERVICE_CIDR,
    metallb: null,
  };
}

/** Whether the load balancer is an instance of the tenant's (and needs IncusCloud's forward). */
export const lbIsInstance = (lb: LbSpec): lb is Extract<LbSpec, { type: "lxc" | "oci" }> => lb.type === "lxc" || lb.type === "oci";

const flavorOf = (f: string) => parseFlavor(f) ?? { cpu: 0, memoryGiB: 0 };

/** What a cluster (or, with `lb: false`, added nodes) of this spec counts against the tenant's quota. */
export function usageOfSpec(spec: K8sSpec, controlPlanes: number, workers: number, opts: { lb?: boolean } = {}): Usage {
  const cp = flavorOf(spec.controlPlane.flavor);
  const w = flavorOf(spec.worker.flavor);
  const lb = opts.lb !== false && lbIsInstance(spec.loadBalancer) ? flavorOf(spec.loadBalancer.flavor) : null;
  const instances = controlPlanes + workers + (lb ? 1 : 0);
  return {
    instances,
    cpu: controlPlanes * cp.cpu + workers * w.cpu + (lb?.cpu ?? 0),
    memory: Math.round((controlPlanes * cp.memoryGiB + workers * w.memoryGiB + (lb?.memoryGiB ?? 0)) * GiB),
    disk: instances * NODE_DISK,
  };
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
/** Nothing (no override), a member, or @group: names only, as the template takes them. */
const MEMBER = /^([A-Za-z0-9][A-Za-z0-9._-]{0,62})?$/;
const TARGET = /^(@?[A-Za-z0-9][A-Za-z0-9._-]{0,62})?$/;
const cidrOk = (c: string) => {
  const [ip, bits, extra] = c.split("/");
  return extra === undefined && !!ip && IPV4.test(ip) && /^\d+$/.test(bits ?? "") && Number(bits) <= 32;
};

/** Why a spec cannot be used, or null. */
export function specError(s: K8sSpec): string | null {
  for (const [role, f] of [
    ["control plane", s.controlPlane.flavor],
    ["worker", s.worker.flavor],
    ...(lbIsInstance(s.loadBalancer) ? [["load balancer", s.loadBalancer.flavor]] : []),
  ] as Array<[string, string]>) {
    if (!parseFlavor(f)) return `The ${role} flavor "${f}" must be c<cores>-m<GiB>`;
  }
  const cp = parseFlavor(s.controlPlane.flavor)!;
  if (cp.cpu < CP_MIN_CPU) return `A control plane needs at least ${CP_MIN_CPU} CPUs (kubeadm)`;
  if (cp.memoryGiB * 1024 < CP_MIN_MEMORY_MIB) return `A control plane needs at least ${CP_MIN_MEMORY_MIB} MiB of memory (kubeadm)`;
  if (!cidrOk(s.podCidr)) return `The pod CIDR "${s.podCidr}" is not an IPv4 CIDR`;
  if (!cidrOk(s.serviceCidr)) return `The service CIDR "${s.serviceCidr}" is not an IPv4 CIDR`;
  if (s.loadBalancer.type === "kube-vip" && !s.loadBalancer.host.trim()) return "kube-vip needs its virtual IP address";
  if (s.loadBalancer.type === "ovn" && (!s.loadBalancer.host.trim() || !s.loadBalancer.networkName.trim()))
    return "An OVN load balancer needs its address and its OVN network";
  if (s.metallb && !s.metallb.addresses.length) return "MetalLB needs at least one address range";
  const bad = s.metallb?.addresses.find((a) => parseRange(a) === null);
  if (bad !== undefined) return `"${bad}" is not an IPv4 range (a.b.c.d-e.f.g.h), CIDR or address`;
  for (const [role, target] of [["control plane", s.controlPlane.target], ["worker", s.worker.target]] as const)
    if (!TARGET.test(target)) return `The ${role} target "${target}" is not a member or @group`;
  // The endpoint's forward goes to the load balancer's member, so Incus must not choose it.
  if (lbIsInstance(s.loadBalancer) && !MEMBER.test(s.loadBalancer.target)) return `The load balancer's target is a member, not "${s.loadBalancer.target}"`;
  if (!lbIsInstance(s.loadBalancer) && !isIP(s.loadBalancer.host)) return `The load balancer address "${s.loadBalancer.host}" is not an IP address`;
  // Tenant projects are restricted, and Incus refuses privileged containers in them.
  if (s.privileged) return "Tenant projects do not allow privileged containers";
  return null;
}
