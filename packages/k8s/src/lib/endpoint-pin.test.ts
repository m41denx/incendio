import { describe, expect, it } from "bun:test";
import {
  applyClassPatch,
  classEndpointPatch,
  clusterClassName,
  endpointHost,
  endpointProblem,
  ENDPOINT_PATCH,
  ENDPOINT_VARIABLE,
  haproxyLoadBalancer,
  LB_PROFILE,
  manifestList,
  parseManifest,
  pinEndpoint,
} from "./endpoint-pin.ts";

// Trimmed `clusterctl generate cluster` output (CAPN v0.9.1 default template).
const generated = (loadBalancer: string) => `apiVersion: cluster.x-k8s.io/v1beta2
kind: Cluster
metadata:
  name: lbt
spec:
  topology:
    classRef:
      name: capn-v1beta2
    version: v1.37.0
    variables:
    - name: secretRef
      value: incendio-lbt
    - name: loadBalancer
      value:
        ${loadBalancer}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: lbt-kube-flannel
data:
  cni.yaml: |
    kind: Namespace
`;

describe("classEndpointPatch", () => {
  const cc = {
    spec: {
      infrastructure: {
        templateRef: {
          apiVersion: "infrastructure.cluster.x-k8s.io/v1alpha2",
          kind: "LXCClusterTemplate",
        },
      },
      variables: [{ name: "secretRef" }, { name: "loadBalancer" }],
      patches: [{ name: "lxcCluster" }],
    },
  };

  it("appends the variable and a patch that runs after the class's own", () => {
    const ops = classEndpointPatch(cc);
    expect(ops.map((o) => o.path)).toEqual(["/spec/variables/-", "/spec/patches/-"]);
    const patch = ops[1]!.value as {
      name: string;
      enabledIf: string;
      definitions: { selector: { kind: string }; jsonPatches: { path: string; valueFrom: { template: string } }[] }[];
    };
    expect(patch.name).toBe(ENDPOINT_PATCH);
    expect(patch.enabledIf).toBe(`{{ if .${ENDPOINT_VARIABLE} }}true{{ end }}`);
    expect(patch.definitions[0]!.selector.kind).toBe("LXCClusterTemplate");
    expect(patch.definitions[0]!.jsonPatches[0]!.path).toBe(
      "/spec/template/spec/controlPlaneEndpoint",
    );
    expect(patch.definitions[0]!.jsonPatches[0]!.valueFrom.template).toContain("port: 6443");
  });

  it("is a no-op once applied", () => {
    const done = {
      spec: {
        ...cc.spec,
        variables: [...cc.spec.variables, { name: ENDPOINT_VARIABLE }],
        patches: [...cc.spec.patches, { name: ENDPOINT_PATCH }],
      },
    };
    expect(classEndpointPatch(done)).toEqual([]);
  });

  it("applies to a class shipped inside the manifest", () => {
    const patched = applyClassPatch(cc, classEndpointPatch(cc));
    expect(patched.spec?.variables?.map((v) => v.name)).toEqual([
      "secretRef",
      "loadBalancer",
      ENDPOINT_VARIABLE,
    ]);
    expect(patched.spec?.patches?.map((p) => p.name)).toEqual(["lxcCluster", ENDPOINT_PATCH]);
    expect(classEndpointPatch(patched)).toEqual([]);
    expect(cc.spec.variables).toHaveLength(2);
  });
});

describe("pinEndpoint", () => {
  it("sets the variable and adds the address profile to an lxc load balancer", () => {
    const docs = parseManifest(generated("lxc: {profiles: [default], flavor: c1-m1}"));
    expect(clusterClassName(docs)).toBe("capn-v1beta2");
    const pinned = pinEndpoint(docs, "10.133.241.254");
    const vars = pinned?.[0]?.spec?.topology?.variables ?? [];
    expect(vars.find((v) => v.name === "loadBalancer")?.value).toEqual({
      lxc: { profiles: ["default", LB_PROFILE], flavor: "c1-m1" },
    });
    expect(vars.find((v) => v.name === ENDPOINT_VARIABLE)?.value).toBe("10.133.241.254");
    // Other documents pass through, and the input is left alone.
    expect(pinned?.[1]).toBe(docs[1]!);
    expect(haproxyLoadBalancer(docs)?.spec.profiles).toEqual(["default"]);
  });

  it("gives an oci load balancer without profiles the default one too", () => {
    const pinned = pinEndpoint(parseManifest(generated("oci: {}")), "10.0.0.9");
    const lb = pinned?.[0]?.spec?.topology?.variables?.find((v) => v.name === "loadBalancer");
    expect(lb?.value).toEqual({ oci: { profiles: ["default", LB_PROFILE] } });
  });

  it("leaves load balancers with their own address alone", () => {
    expect(pinEndpoint(parseManifest(generated("kube-vip: {host: 10.0.0.2}")), "10.0.0.9")).toBeNull();
    expect(
      pinEndpoint(parseManifest(generated("ovn: {host: 10.0.0.2, networkName: ovn0}")), "10.0.0.9"),
    ).toBeNull();
  });

  it("serializes to a kubectl List", () => {
    const list = JSON.parse(manifestList(parseManifest(generated("lxc: {}")))) as {
      kind: string;
      items: { kind: string }[];
    };
    expect(list.kind).toBe("List");
    expect(list.items.map((i) => i.kind)).toEqual(["Cluster", "ConfigMap"]);
  });
});

describe("endpointProblem", () => {
  it("reads hosts out of endpoints", () => {
    expect(endpointHost("https://10.0.0.1:6443")).toBe("10.0.0.1");
    expect(endpointHost("https://[fd42::5]:6443")).toBe("fd42::5");
    expect(endpointHost(undefined)).toBeUndefined();
  });

  it("flags an IPv6 endpoint on an haproxy load balancer that is not up", () => {
    const endpoint = "https://[fd42:54ae:9c5e:19fa:1266:6aff:fe58:d4a3]:6443";
    expect(endpointProblem({ endpoint, available: false, haproxy: true })).toContain("IPv6");
    expect(endpointProblem({ endpoint, available: true, haproxy: true })).toBeUndefined();
    expect(endpointProblem({ endpoint, available: false, haproxy: false })).toBeUndefined();
    expect(
      endpointProblem({ endpoint: "https://10.0.0.1:6443", available: false, haproxy: true }),
    ).toBeUndefined();
  });
});
