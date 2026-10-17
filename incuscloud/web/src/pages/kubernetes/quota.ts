import { resolveFlavor, type K8sClusterConfig } from "@incendio/ui/util/k8s/capn";
import type { K8sSpec } from "../../api/types";
const csv = (s: string) => s.split(",").map(v => v.trim()).filter(Boolean);
/** MetalLB ranges: separated by commas or spaces, as Incendio's metallbAddressesError reads them. */
export const ranges = (s: string) => s.split(/[,\s]+/).filter(Boolean);
export function specOfConfig(c: K8sClusterConfig, lbTarget = "", lbInterface = "eth0"): K8sSpec {
  return {
    controlPlane: { type: c.controlPlaneType, flavor: resolveFlavor(c.controlPlaneCustomFlavor,c.controlPlaneFlavor,c.controlPlaneCpu,c.controlPlaneMemory,c.controlPlaneMemoryUnit), profiles: csv(c.controlPlaneProfiles), target: c.controlPlaneTarget },
    worker: { type: c.workerType, flavor: resolveFlavor(c.workerCustomFlavor,c.workerFlavor,c.workerCpu,c.workerMemory,c.workerMemoryUnit), profiles: csv(c.workerProfiles), target: c.workerTarget },
    loadBalancer: c.loadBalancer === "kube-vip" ? { type: "kube-vip", host: c.lbHost.trim(), interface: lbInterface.trim() }
      : c.loadBalancer === "ovn" ? { type: "ovn", host: c.lbHost.trim(), networkName: c.lbNetworkName.trim() }
      : { type: c.loadBalancer, flavor: c.lbFlavor.trim(), profiles: csv(c.lbProfiles), target: lbTarget },
    image: c.imageName.trim(), privileged: c.privileged, flannel: c.deployKubeFlannel, installKubeadm: c.installKubeadm,
    podCidr: c.podCidr.trim(), serviceCidr: c.serviceCidr.trim(), metallb: c.metallb ? { addresses: ranges(c.metallbAddresses) } : null,
  };
}
const resources = (flavor: string) => {
  const m = /^c(\d+)-m(\d+(?:\.\d+)?)$/.exec(flavor);
  return m && +m[1] > 0 && +m[2] > 0 ? { cpu: +m[1], memoryGiB: +m[2] } : null;
};
/** Same arithmetic as the server: one 10 GiB disk per machine; VIPs cost no instance. */
export function usageOfSpec(spec: K8sSpec, cp: number, workers: number) {
  const c = resources(spec.controlPlane.flavor), w = resources(spec.worker.flavor);
  const lb = "flavor" in spec.loadBalancer ? resources(spec.loadBalancer.flavor) : null;
  const instances = cp + workers + ("flavor" in spec.loadBalancer ? 1 : 0);
  return { instances, cpu: cp * (c?.cpu ?? 0) + workers * (w?.cpu ?? 0) + (lb?.cpu ?? 0),
    memory: (cp * (c?.memoryGiB ?? 0) + workers * (w?.memoryGiB ?? 0) + (lb?.memoryGiB ?? 0)) * 2 ** 30, disk: instances * 10 * 2 ** 30 };
}
export function specIssue(s: K8sSpec): string | null {
  for (const [role, flavor] of [["Control plane",s.controlPlane.flavor],["Workers",s.worker.flavor],...("flavor" in s.loadBalancer ? [["Load balancer",s.loadBalancer.flavor]] : [])])
    if (!resources(flavor)) return `${role} flavor must be c<cores>-m<GiB>, with positive resources.`;
  for (const cidr of [s.podCidr,s.serviceCidr]) {
    const [ip, bits] = cidr.split("/");
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.split(".").some(v => +v > 255) || !/^\d+$/.test(bits ?? "") || +bits > 32) return "Pod and service CIDRs must be valid IPv4 CIDRs.";
  }
  if ("host" in s.loadBalancer && !s.loadBalancer.host) return "Load balancer address is required.";
  if (s.loadBalancer.type === "ovn" && !s.loadBalancer.networkName) return "OVN network is required.";
  return null;
}
