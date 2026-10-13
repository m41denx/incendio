import { expect, test } from "vitest";
import { usageOfSpec as serverUsage } from "../../../../server/src/k8s/model";
import { defaultK8sClusterConfig } from "@incendio/ui/util/k8s/capn";
import { specOfConfig, usageOfSpec, specIssue } from "./quota";
import { k8sSpec } from "./fixtures";
test("quota arithmetic matches the server for each load balancer and fractional flavors", () => {
  for (const type of ["lxc", "oci", "kube-vip", "ovn"] as const) {
    const s = k8sSpec({ controlPlane: { type: "virtual-machine", flavor: "c4-m8", profiles: [], target: "" }, worker: { type: "container", flavor: "c1-m0.5", profiles: [], target: "" },
      loadBalancer: type === "kube-vip" ? { type, host: "10.0.0.3", interface: "eth0" } : type === "ovn" ? { type, host: "10.0.0.3", networkName: "ovn" } : { type, flavor: "c1-m1", profiles: [], target: "" } });
    for (const cp of [1,3,5]) for (const w of [0,2,20]) expect(usageOfSpec(s,cp,w)).toEqual(serverUsage(s,cp,w));
  }
});
test("config mapping keeps every option and VIPs do not consume an LB machine", () => {
  const s = specOfConfig({ ...defaultK8sClusterConfig, loadBalancer: "kube-vip", lbHost: "10.0.0.3", metallb: true, metallbAddresses: "10.0.1.1-10.0.1.5, 10.0.2.0/24", controlPlaneProfiles: "default, cp", controlPlaneMemory: 2048, controlPlaneMemoryUnit: "MB" });
  expect(s.controlPlane.flavor).toBe("c2-m2");
  expect(s.controlPlane.profiles).toEqual(["default","cp"]);
  expect(s.metallb?.addresses).toHaveLength(2);
  expect(usageOfSpec(s,1,0).instances).toBe(1);
  expect(specIssue(s)).toBeNull();
  expect(specIssue({...s, worker: {...s.worker, flavor: "t3.medium"}})).toMatch(/must be c/);
});
