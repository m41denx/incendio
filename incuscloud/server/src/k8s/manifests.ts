import type { KubeObject } from "./kube.ts";
import { CLASS_NAME, CLASS_NAMESPACE, namespaceOf, type K8sSpec } from "./model.ts";
import classYaml from "./clusterclass.yaml" with { type: "text" };
import flannelYaml from "./flannel-cni.yaml" with { type: "text" };

/** Our ClusterClass (derived from CAPN's) and its templates, in incuscloud-system. */
export function classBundle(): KubeObject[] {
  const docs = (Bun.YAML.parse(classYaml) as (KubeObject | null)[]).filter((d): d is KubeObject => !!d);
  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: CLASS_NAMESPACE } },
    ...docs.map((d) => ({ ...d, metadata: { ...d.metadata, namespace: CLASS_NAMESPACE } })),
  ];
}

/** A tenant's namespace, and flannel for each of its clusters labelled to deploy it (CAPN's template). */
export function tenantBundle(slug: string): KubeObject[] {
  const namespace = namespaceOf(slug);
  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels: { "incuscloud.io/tenant": slug } } },
    { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "kube-flannel", namespace }, data: { "cni.yaml": flannelYaml } },
    {
      apiVersion: "addons.cluster.x-k8s.io/v1beta2",
      kind: "ClusterResourceSet",
      metadata: { name: "kube-flannel", namespace },
      spec: {
        clusterSelector: { matchLabels: { "capn.cluster.x-k8s.io/deploy-kube-flannel": "true" } },
        resources: [{ kind: "ConfigMap", name: "kube-flannel" }],
        strategy: "ApplyOnce",
      },
    },
  ];
}

/** CAPN's identity secret: how its controller reaches one Incus cluster, as a certificate restricted to one project. */
export function identitySecret(s: { namespace: string; name: string; server: string; serverCert: string; cert: string; key: string; project: string }): KubeObject {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: s.name, namespace: s.namespace, labels: { "clusterctl.cluster.x-k8s.io/move": "true", "incuscloud.io/credentials": "true" } },
    type: "Opaque",
    stringData: { server: s.server, "server-crt": s.serverCert, "client-crt": s.cert, "client-key": s.key, project: s.project },
  };
}

export interface ClusterSpec {
  id: string;
  /** The cluster's ClusterClass when it already has one (by default the current one). */
  className?: string;
  name: string;
  namespace: string;
  version: string;
  controlPlanes: number;
  workers: number;
  spec: K8sSpec;
  endpointHost: string;
  endpointPort: number;
  /** The identity secret's name. */
  secretName: string;
}

/**
 * A workload cluster on our ClusterClass: unprivileged container nodes, behind
 * CAPN's haproxy, on a preset endpoint. With `member`, the load balancer and
 * every node go on that member (without OVN, each member's bridge is its own network).
 */
/** CAPN's `instance` variable for one role. */
const instanceOf = (m: K8sSpec["controlPlane"], spec: K8sSpec) => ({
  type: m.type,
  flavor: m.flavor,
  profiles: m.profiles,
  devices: [],
  image: spec.image,
  installKubeadm: spec.installKubeadm,
  target: m.target,
});

/** CAPN's `loadBalancer` variable: as it was before specs for an lxc one on `default` (no rollout on re-apply). */
function loadBalancerOf(lb: K8sSpec["loadBalancer"]): Record<string, Record<string, unknown>> {
  if (lb.type === "kube-vip") return { "kube-vip": { host: lb.host, ...(lb.interface ? { interface: lb.interface } : {}) } };
  if (lb.type === "ovn") return { ovn: { host: lb.host, networkName: lb.networkName } };
  const plainProfiles = lb.profiles.length === 1 && lb.profiles[0] === "default";
  return { [lb.type]: { flavor: lb.flavor, ...(lb.profiles.length && !plainProfiles ? { profiles: lb.profiles } : {}), ...(lb.target ? { target: lb.target } : {}) } };
}

export function clusterManifest(c: ClusterSpec): KubeObject {
  const { spec } = c;
  return {
    apiVersion: "cluster.x-k8s.io/v1beta2",
    kind: "Cluster",
    metadata: {
      name: c.name,
      namespace: c.namespace,
      labels: { ...(spec.flannel ? { "capn.cluster.x-k8s.io/deploy-kube-flannel": "true" } : {}), "incuscloud.io/k8s-id": c.id },
    },
    spec: {
      clusterNetwork: { pods: { cidrBlocks: [spec.podCidr] }, services: { cidrBlocks: [spec.serviceCidr] }, serviceDomain: "cluster.local" },
      // An instance load balancer is reached through a forward; kube-vip and OVN at their own address.
      controlPlaneEndpoint: { host: c.endpointHost, port: c.endpointPort },
      topology: {
        classRef: { name: c.className ?? CLASS_NAME, namespace: CLASS_NAMESPACE },
        version: c.version,
        controlPlane: { replicas: c.controlPlanes },
        variables: [
          { name: "secretRef", value: c.secretName },
          { name: "privileged", value: spec.privileged },
          { name: "loadBalancer", value: loadBalancerOf(spec.loadBalancer) },
          { name: "instance", value: instanceOf(spec.controlPlane, spec) },
          { name: "workerInstance", value: instanceOf(spec.worker, spec) },
        ],
        workers: { machineDeployments: [{ class: "default-worker", name: "md-0", replicas: c.workers }] },
      },
    },
  };
}
