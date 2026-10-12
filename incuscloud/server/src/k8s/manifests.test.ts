import { expect, test } from "bun:test";
import { classBundle, clusterManifest, identitySecret, tenantBundle } from "./manifests.ts";

test("the class bundle is our ClusterClass and its templates, all in incuscloud-system", () => {
  const b = classBundle();
  expect(b.map((o) => `${o.kind}/${o.metadata.name}`)).toEqual([
    "Namespace/incuscloud-system",
    "ClusterClass/incuscloud-v1",
    "KubeadmControlPlaneTemplate/incuscloud-v1-control-plane",
    "LXCClusterTemplate/incuscloud-v1-lxc-cluster",
    "LXCMachineTemplate/incuscloud-v1-control-plane",
    "LXCMachineTemplate/incuscloud-v1-default-worker",
    "KubeadmConfigTemplate/incuscloud-v1-default-worker",
  ]);
  expect(b.slice(1).every((o) => o.metadata.namespace === "incuscloud-system")).toBe(true);
});

test("the derived class keeps both changes: no kubeadm profile, nesting on container nodes", () => {
  const text = JSON.stringify(classBundle().find((o) => o.kind === "ClusterClass"));
  expect(text).toContain("skipDefaultKubeadmProfile: true");
  expect(text.match(/security\.nesting: \\"true\\"/g)?.length).toBe(2);
  expect(text).not.toContain("capn-v1beta2");
});

test("a tenant's bundle: its namespace, and flannel applied once to each of its clusters that asks", () => {
  const [ns, cm, crs] = tenantBundle("acme");
  expect(ns).toMatchObject({ kind: "Namespace", metadata: { name: "ic-acme", labels: { "incuscloud.io/tenant": "acme" } } });
  expect(cm).toMatchObject({ kind: "ConfigMap", metadata: { name: "kube-flannel", namespace: "ic-acme" } });
  expect((cm!.data as Record<string, string>)["cni.yaml"]).toContain("kind: DaemonSet");
  expect(crs).toMatchObject({
    apiVersion: "addons.cluster.x-k8s.io/v1beta2",
    kind: "ClusterResourceSet",
    metadata: { name: "kube-flannel", namespace: "ic-acme" },
    spec: { clusterSelector: { matchLabels: { "capn.cluster.x-k8s.io/deploy-kube-flannel": "true" } }, resources: [{ kind: "ConfigMap", name: "kube-flannel" }], strategy: "ApplyOnce" },
  });
});

test("the identity secret is CAPN's format, restricted to the tenant's project", () => {
  const s = identitySecret({ namespace: "ic-acme", name: "incus-lab", server: "https://10.0.0.1:8443", serverCert: "S", cert: "C", key: "K", project: "acme" });
  expect(s).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "incus-lab", namespace: "ic-acme", labels: { "clusterctl.cluster.x-k8s.io/move": "true", "incuscloud.io/credentials": "true" } },
    type: "Opaque",
    stringData: { server: "https://10.0.0.1:8443", "server-crt": "S", "client-crt": "C", "client-key": "K", project: "acme" },
  });
});

const row = { id: "k-1", name: "web", namespace: "ic-acme", version: "v1.36.4", controlPlanes: 1, workers: 2, size: "medium" as const, endpointHost: "10.0.0.5", endpointPort: 16443, secretName: "incus-lab" };

test("a cluster: our class across namespaces, the preset endpoint, unprivileged nodes, sizes and counts", () => {
  const c = clusterManifest(row, { member: "m2" });
  expect(c).toMatchObject({
    apiVersion: "cluster.x-k8s.io/v1beta2",
    kind: "Cluster",
    metadata: { name: "web", namespace: "ic-acme", labels: { "capn.cluster.x-k8s.io/deploy-kube-flannel": "true", "incuscloud.io/k8s-id": "k-1" } },
    spec: {
      controlPlaneEndpoint: { host: "10.0.0.5", port: 16443 },
      topology: {
        classRef: { name: "incuscloud-v1", namespace: "incuscloud-system" },
        version: "v1.36.4",
        controlPlane: { replicas: 1 },
        workers: { machineDeployments: [{ class: "default-worker", name: "md-0", replicas: 2 }] },
      },
    },
  });
  const vars = Object.fromEntries((c.spec as { topology: { variables: { name: string; value: unknown }[] } }).topology.variables.map((v) => [v.name, v.value]));
  expect(vars).toEqual({
    secretRef: "incus-lab",
    privileged: false,
    loadBalancer: { lxc: { flavor: "c1-m1", target: "m2" } },
    // The nodes on the load balancer's member: without OVN, each member's bridge is its own network.
    instance: { type: "container", flavor: "c2-m4", profiles: ["default"], devices: [], image: "", installKubeadm: false, target: "m2" },
  });
});

test("without a member (a single-member Incus cluster) no target is set", () => {
  const vars = (clusterManifest(row, {}).spec as { topology: { variables: { name: string; value: unknown }[] } }).topology.variables;
  expect(vars.find((v) => v.name === "loadBalancer")!.value).toEqual({ lxc: { flavor: "c1-m1" } });
  expect(vars.find((v) => v.name === "instance")!.value).toMatchObject({ target: "" });
});
