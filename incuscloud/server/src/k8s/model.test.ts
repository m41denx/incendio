import { expect, test } from "bun:test";
import { KUBERNETES_VERSIONS, SIZES, namespaceOf, parseFlavor, specError, specFromSize, upgradeError, usageOf, usageOfSpec, type K8sSpec } from "./model.ts";

const GiB = 1024 ** 3;

test("sizes are CAPN flavors (Incus instance types)", () => {
  expect(SIZES.small).toEqual({ cpu: 2, memoryGiB: 2, flavor: "c2-m2" });
  expect(SIZES.medium.flavor).toBe("c2-m4");
  expect(SIZES.large.flavor).toBe("c4-m8");
});

test("a cluster's usage counts every node and the load balancer, with a 10 GiB root disk each", () => {
  expect(usageOf("medium", 1, 2)).toEqual({ instances: 4, cpu: 2 * 3 + 1, memory: 3 * 4 * GiB + GiB, disk: 4 * 10 * GiB });
  expect(usageOf("small", 3, 0)).toEqual({ instances: 4, cpu: 7, memory: 7 * GiB, disk: 40 * GiB });
});

test("usage of added nodes alone, for a scale-up (no load balancer)", () => {
  expect(usageOf("large", 0, 2, { lb: false })).toEqual({ instances: 2, cpu: 8, memory: 16 * GiB, disk: 20 * GiB });
});

test("upgrades go one minor version forward, to an offered version", () => {
  expect(KUBERNETES_VERSIONS).toEqual(["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"]);
  expect(upgradeError("v1.36.4", "v1.37.0")).toBeNull();
  expect(upgradeError("v1.36.4", "v1.36.4")).toBeNull();
  expect(upgradeError("v1.35.5", "v1.37.0")).toBe("Upgrade one minor version at a time: v1.35.5 can go to v1.36 next");
  expect(upgradeError("v1.37.0", "v1.36.4")).toBe("Kubernetes cannot be downgraded (v1.37.0 to v1.36.4)");
  expect(upgradeError("v1.36.4", "v1.37.9")).toBe("v1.37.9 is not offered; choose one of v1.34.0, v1.35.5, v1.36.4, v1.37.0");
});

test("each tenant's clusters live in namespace ic-<slug>", () => {
  expect(namespaceOf("acme")).toBe("ic-acme");
});

test("flavors are CAPN's c<cores>-m<GiB> (GiB may be fractional); anything else is not counted", () => {
  expect(parseFlavor("c2-m4")).toEqual({ cpu: 2, memoryGiB: 4 });
  expect(parseFlavor(" c1-m0.5 ")).toEqual({ cpu: 1, memoryGiB: 0.5 });
  expect(parseFlavor("t3.micro")).toBeNull();
  expect(parseFlavor("c0-m1")).toBeNull();
});

test("a size is a spec: today's manifest values", () => {
  const s = specFromSize("medium");
  expect(s.controlPlane).toEqual({ type: "container", flavor: "c2-m4", profiles: ["default"], target: "" });
  expect(s.worker).toEqual(s.controlPlane);
  expect(s.loadBalancer).toEqual({ type: "lxc", flavor: "c1-m1", profiles: ["default"], target: "" });
  expect(s).toMatchObject({ image: "", privileged: false, flannel: true, installKubeadm: false, podCidr: "10.244.0.0/16", serviceCidr: "10.96.0.0/12", metallb: null });
  expect(specFromSize("small", "d1").controlPlane.target).toBe("d1");
  expect(specFromSize("small", "d1").loadBalancer).toMatchObject({ target: "d1" });
});

test("a spec counts like its size did", () => {
  for (const size of Object.keys(SIZES) as Array<keyof typeof SIZES>) {
    expect(usageOfSpec(specFromSize(size), 3, 2)).toEqual(usageOf(size, 3, 2));
    expect(usageOfSpec(specFromSize(size), 0, 2, { lb: false })).toEqual(usageOf(size, 0, 2, { lb: false }));
  }
});

test("a spec counts each role's flavor; a kube-vip or OVN load balancer is no instance", () => {
  const s: K8sSpec = { ...specFromSize("medium"), controlPlane: { type: "virtual-machine", flavor: "c4-m8", profiles: [], target: "" }, worker: { type: "container", flavor: "c2-m0.5", profiles: [], target: "" } };
  expect(usageOfSpec(s, 3, 2)).toEqual({ instances: 6, cpu: 12 + 4 + 1, memory: (24 + 1 + 1) * GiB, disk: 60 * GiB });
  const vip: K8sSpec = { ...s, loadBalancer: { type: "kube-vip", host: "10.0.0.5", interface: "" } };
  expect(usageOfSpec(vip, 3, 2)).toEqual({ instances: 5, cpu: 16, memory: 25 * GiB, disk: 50 * GiB });
});

test("what a spec may not be", () => {
  const ok = specFromSize("medium");
  expect(specError(ok)).toBeNull();
  expect(specError({ ...ok, controlPlane: { ...ok.controlPlane, flavor: "c1-m4" } })).toMatch(/control plane needs at least 2 CPUs/);
  expect(specError({ ...ok, controlPlane: { ...ok.controlPlane, flavor: "c2-m1" } })).toMatch(/1700 MiB/);
  expect(specError({ ...ok, worker: { ...ok.worker, flavor: "t3.micro" } })).toMatch(/must be c<cores>-m<GiB>/);
  expect(specError({ ...ok, podCidr: "10.244.0.0" })).toMatch(/pod CIDR/);
  expect(specError({ ...ok, serviceCidr: "300.1.0.0/12" })).toMatch(/service CIDR/);
  expect(specError({ ...ok, loadBalancer: { type: "kube-vip", host: "", interface: "" } })).toMatch(/virtual IP/);
  expect(specError({ ...ok, loadBalancer: { type: "ovn", host: "10.0.0.9", networkName: "" } })).toMatch(/OVN network/);
  expect(specError({ ...ok, metallb: { addresses: [] } })).toMatch(/MetalLB/);
});

test("a spec only holds what a tenant project and the template can take", () => {
  const ok = specFromSize("medium");
  const lb = ok.loadBalancer as Extract<K8sSpec["loadBalancer"], { type: "lxc" | "oci" }>;
  expect(specError({ ...ok, worker: { ...ok.worker, target: "@general" } })).toBeNull();
  expect(specError({ ...ok, controlPlane: { ...ok.controlPlane, target: "m1" } })).toBeNull();
  expect(specError({ ...ok, worker: { ...ok.worker, target: "m1\nunprivileged: false" } })).toMatch(/worker target/);
  expect(specError({ ...ok, controlPlane: { ...ok.controlPlane, target: "@" } })).toMatch(/control plane target/);
  // The forward follows the load balancer's member: a group would let Incus place it elsewhere.
  expect(specError({ ...ok, loadBalancer: { ...lb, target: "@general" } })).toMatch(/load balancer's target is a member/);
  expect(specError({ ...ok, loadBalancer: { ...lb, target: "m 1" } })).toMatch(/load balancer's target is a member/);
  // Tenant projects are restricted: Incus refuses privileged containers there.
  expect(specError({ ...ok, privileged: true })).toMatch(/privileged/);
  expect(specError({ ...ok, metallb: { addresses: ["10.0.0.200-10.0.0.210 10.0.1.0/29"] } })).toMatch(/"10.0.0.200-10.0.0.210 10.0.1.0\/29" is not an IPv4 range/);
  expect(specError({ ...ok, metallb: { addresses: ["10.0.0.200-10.0.0.210", "10.0.1.0/29"] } })).toBeNull();
  expect(specError({ ...ok, loadBalancer: { type: "kube-vip", host: " 10.0.0.5", interface: "" } })).toMatch(/not an IP address/);
  expect(specError({ ...ok, loadBalancer: { type: "ovn", host: "api.example", networkName: "ovn0" } })).toMatch(/not an IP address/);
});
