import { specFromSize } from "./model.ts";
import classYamlText from "./clusterclass.yaml" with { type: "text" };
import { expect, test } from "bun:test";
import { classBundle, clusterManifest, identitySecret, tenantBundle } from "./manifests.ts";

test("the class bundle is our ClusterClass and its templates, all in incuscloud-system", () => {
  const b = classBundle();
  expect(b.map((o) => `${o.kind}/${o.metadata.name}`)).toEqual([
    "Namespace/incuscloud-system",
    "ClusterClass/incuscloud-v2",
    "KubeadmControlPlaneTemplate/incuscloud-v2-control-plane",
    "LXCClusterTemplate/incuscloud-v1-lxc-cluster",
    "LXCMachineTemplate/incuscloud-v1-control-plane",
    "LXCMachineTemplate/incuscloud-v1-default-worker",
    "KubeadmConfigTemplate/incuscloud-v2-default-worker",
  ]);
  expect(b.slice(1).every((o) => o.metadata.namespace === "incuscloud-system")).toBe(true);
});

test("the derived class keeps both changes: no kubeadm profile, nesting on container nodes", () => {
  const text = JSON.stringify(classBundle().find((o) => o.kind === "ClusterClass"));
  expect(text).toContain("skipDefaultKubeadmProfile: true");
  expect(text.match(/security\.nesting: \\"true\\"/g)?.length).toBe(2);
  expect(text).not.toContain("capn-v1beta2");
});

test("kubeadm's SystemVerification is only a warning on every node (no kernel config reaches a tenant's container)", () => {
  const docs = classBundle() as unknown as { kind: string; spec?: any }[];
  const kcp = docs.find((d) => d.kind === "KubeadmControlPlaneTemplate")!.spec.template.spec.kubeadmConfigSpec;
  const worker = docs.find((d) => d.kind === "KubeadmConfigTemplate")!.spec.template.spec;
  for (const reg of [kcp.initConfiguration.nodeRegistration, kcp.joinConfiguration.nodeRegistration, worker.joinConfiguration.nodeRegistration]) {
    expect(reg.ignorePreflightErrors).toEqual(["SystemVerification"]);
  }
});

test("unprivileged container nodes run without local storage capacity isolation (a ZFS root has no filesystem info)", () => {
  const text = JSON.stringify(classBundle().find((o) => o.kind === "ClusterClass"));
  expect(text.match(/localStorageCapacityIsolation: false/g)?.length).toBe(2);
});

test("a cluster made with an older class stays on it", () => {
  const ref = (c: ReturnType<typeof clusterManifest>) => (c.spec as { topology: { classRef: { name: string } } }).topology.classRef.name;
  expect(ref(clusterManifest(row))).toBe("incuscloud-v2");
  expect(ref(clusterManifest({ ...row, className: "incuscloud-v1" }))).toBe("incuscloud-v1");
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

const row = { id: "k-1", name: "web", namespace: "ic-acme", version: "v1.36.4", controlPlanes: 1, workers: 2, spec: specFromSize("medium"), endpointHost: "10.0.0.5", endpointPort: 16443, secretName: "incus-lab" };

test("a cluster: our class across namespaces, the preset endpoint, unprivileged nodes, sizes and counts", () => {
  const c = clusterManifest({ ...row, spec: specFromSize("medium", "m2") });
  expect(c).toMatchObject({
    apiVersion: "cluster.x-k8s.io/v1beta2",
    kind: "Cluster",
    metadata: { name: "web", namespace: "ic-acme", labels: { "capn.cluster.x-k8s.io/deploy-kube-flannel": "true", "incuscloud.io/k8s-id": "k-1" } },
    spec: {
      controlPlaneEndpoint: { host: "10.0.0.5", port: 16443 },
      topology: {
        classRef: { name: "incuscloud-v2", namespace: "incuscloud-system" },
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
    workerInstance: { type: "container", flavor: "c2-m4", profiles: ["default"], devices: [], image: "", installKubeadm: false, target: "m2" },
  });
  expect((c.spec as { clusterNetwork: unknown }).clusterNetwork).toEqual({ pods: { cidrBlocks: ["10.244.0.0/16"] }, services: { cidrBlocks: ["10.96.0.0/12"] }, serviceDomain: "cluster.local" });
});

test("without a member (a single-member Incus cluster) no target is set", () => {
  const vars = (clusterManifest(row).spec as { topology: { variables: { name: string; value: unknown }[] } }).topology.variables;
  expect(vars.find((v) => v.name === "loadBalancer")!.value).toEqual({ lxc: { flavor: "c1-m1" } });
  expect(vars.find((v) => v.name === "instance")!.value).toMatchObject({ target: "" });
});

const varsOf = (c: ReturnType<typeof clusterManifest>) => Object.fromEntries((c.spec as { topology: { variables: { name: string; value: unknown }[] } }).topology.variables.map((v) => [v.name, v.value]));

test("a spec: each role its own instances, the networks, flannel and privileged as asked", () => {
  const spec = {
    ...specFromSize("medium"),
    controlPlane: { type: "virtual-machine" as const, flavor: "c4-m8", profiles: ["default", "fast"], target: "@gpu" },
    worker: { type: "container" as const, flavor: "c2-m0.5", profiles: ["default"], target: "d2" },
    loadBalancer: { type: "oci" as const, flavor: "c1-m1", profiles: ["lb"], target: "d1" },
    image: "ubuntu/24.04",
    privileged: true,
    flannel: false,
    installKubeadm: true,
    podCidr: "10.200.0.0/16",
    serviceCidr: "10.201.0.0/16",
  };
  const c = clusterManifest({ ...row, spec });
  const vars = varsOf(c);
  expect(vars.privileged).toBe(true);
  expect(vars.loadBalancer).toEqual({ oci: { flavor: "c1-m1", profiles: ["lb"], target: "d1" } });
  expect(vars.instance).toEqual({ type: "virtual-machine", flavor: "c4-m8", profiles: ["default", "fast"], devices: [], image: "ubuntu/24.04", installKubeadm: true, target: "@gpu" });
  expect(vars.workerInstance).toEqual({ type: "container", flavor: "c2-m0.5", profiles: ["default"], devices: [], image: "ubuntu/24.04", installKubeadm: true, target: "d2" });
  expect(c.metadata.labels!["capn.cluster.x-k8s.io/deploy-kube-flannel"]).toBeUndefined();
  expect((c.spec as { clusterNetwork: unknown }).clusterNetwork).toEqual({ pods: { cidrBlocks: ["10.200.0.0/16"] }, services: { cidrBlocks: ["10.201.0.0/16"] }, serviceDomain: "cluster.local" });
});

test("kube-vip and OVN load balancers are addresses", () => {
  const vip = varsOf(clusterManifest({ ...row, spec: { ...specFromSize("medium"), loadBalancer: { type: "kube-vip", host: "10.0.0.50", interface: "" } } }));
  expect(vip.loadBalancer).toEqual({ "kube-vip": { host: "10.0.0.50" } });
  const vipIf = varsOf(clusterManifest({ ...row, spec: { ...specFromSize("medium"), loadBalancer: { type: "kube-vip", host: "10.0.0.50", interface: "eth0" } } }));
  expect(vipIf.loadBalancer).toEqual({ "kube-vip": { host: "10.0.0.50", interface: "eth0" } });
  const ovn = varsOf(clusterManifest({ ...row, spec: { ...specFromSize("medium"), loadBalancer: { type: "ovn", host: "10.10.0.5", networkName: "ovn0" } } }));
  expect(ovn.loadBalancer).toEqual({ ovn: { host: "10.10.0.5", networkName: "ovn0" } });
});

test("our ClusterClass gives workers their own instance spec when one is set", () => {
  expect(classYamlText).toContain("- name: workerInstance");
  const worker = classYamlText.slice(classYamlText.indexOf("- name: workerInstanceSpec"), classYamlText.indexOf("- name: controlPlaneInstallKubeadm"));
  expect(worker).toContain("{{ $i := .instance }}{{ if .workerInstance }}{{ $i = .workerInstance }}{{ end }}");
  expect(worker).not.toContain(".instance.flavor");
  expect(worker).toContain("$i.flavor");
});

test("our ClusterClass: workers' unprivileged patch follows the workers' type; the load balancer's values are quoted", () => {
  const unpriv = classYamlText.slice(classYamlText.indexOf("- name: workerConfigureUnprivileged"));
  const enabledIf = unpriv.slice(unpriv.indexOf("enabledIf:"), unpriv.indexOf("\n", unpriv.indexOf("enabledIf:")));
  expect(enabledIf).toContain("{{ $i := .instance }}{{ if .workerInstance }}{{ $i = .workerInstance }}{{ end }}");
  expect(enabledIf).toContain('ne $i.type "virtual-machine"');
  for (const lb of ["lxc", "oci"]) {
    expect(classYamlText).toContain(`flavor: {{ .loadBalancer.${lb}.flavor | quote }}`);
    expect(classYamlText).toContain(`target: {{ .loadBalancer.${lb}.target | quote }}`);
  }
});
