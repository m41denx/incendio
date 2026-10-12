import { expect, test } from "bun:test";
import { FakeKube } from "./fake-kube.ts";
import { installMetalLB, metallbObjects, metallbState } from "./metallb.ts";

/** A stand-in for MetalLB's native manifest: what kinds it has, in its own order. */
const MANIFEST = `
apiVersion: v1
kind: ServiceAccount
metadata: { name: controller, namespace: metallb-system }
---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata: { name: ipaddresspools.metallb.io }
---
apiVersion: v1
kind: Namespace
metadata: { name: metallb-system }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: controller, namespace: metallb-system }
---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata: { name: l2advertisements.metallb.io }
`;

test("MetalLB's objects: its CRDs, then its namespace, then the rest; the pool and advertisement apart", () => {
  const { base, pool } = metallbObjects(MANIFEST, ["10.0.0.200-10.0.0.220"]);
  expect(base.map((o) => `${o.kind}/${o.metadata.name}`)).toEqual([
    "CustomResourceDefinition/ipaddresspools.metallb.io",
    "CustomResourceDefinition/l2advertisements.metallb.io",
    "Namespace/metallb-system",
    "ServiceAccount/controller",
    "Deployment/controller",
  ]);
  expect(pool).toEqual([
    { apiVersion: "metallb.io/v1beta1", kind: "IPAddressPool", metadata: { name: "incendio", namespace: "metallb-system" }, spec: { addresses: ["10.0.0.200-10.0.0.220"] } },
    { apiVersion: "metallb.io/v1beta1", kind: "L2Advertisement", metadata: { name: "incendio", namespace: "metallb-system" }, spec: { ipAddressPools: ["incendio"] } },
  ]);
});

test("install: everything, then the pool once the controller is available (its webhook checks pools)", async () => {
  const kube = new FakeKube();
  const objs = metallbObjects(MANIFEST, ["10.0.0.200/29"]);
  let looks = 0;
  await installMetalLB(kube, objs, {
    deadlineMs: 60_000,
    sleep: async () => {
      looks++;
      expect(kube.objects.get("metallb.io/v1beta1|IPAddressPool|metallb-system|incendio")).toBeUndefined();
      kube.setStatus("apps/v1", "Deployment", "metallb-system", "controller", { conditions: [{ type: "Available", status: "True" }] });
    },
  });
  expect(looks).toBe(1);
  expect(kube.applied.map((o) => o.kind).slice(-2)).toEqual(["IPAddressPool", "L2Advertisement"]);
  expect(await metallbState(kube)).toEqual({ installed: true, ready: true, addresses: ["10.0.0.200/29"] });
});

test("install gives up when the controller never comes up, saying so", async () => {
  const kube = new FakeKube();
  await expect(installMetalLB(kube, metallbObjects(MANIFEST, ["10.0.0.200/29"]), { deadlineMs: 0, sleep: async () => {} })).rejects.toThrow("MetalLB's controller did not become available in time");
});

test("state: not installed on a bare cluster", async () => {
  expect(await metallbState(new FakeKube())).toEqual({ installed: false, ready: false, addresses: [] });
});
