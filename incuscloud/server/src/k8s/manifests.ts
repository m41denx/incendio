import type { KubeObject } from "./kube.ts";
import { CLASS_NAME, CLASS_NAMESPACE, LB, SIZES, namespaceOf, type Size } from "./model.ts";
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
  name: string;
  namespace: string;
  version: string;
  controlPlanes: number;
  workers: number;
  size: Size;
  endpointHost: string;
  endpointPort: number;
  /** The identity secret's name. */
  secretName: string;
}

/** A workload cluster on our ClusterClass: unprivileged container nodes, behind CAPN's haproxy, on a preset endpoint. */
export function clusterManifest(c: ClusterSpec, opts: { lbTarget?: string }): KubeObject {
  const lxc: Record<string, string> = { flavor: LB.flavor };
  if (opts.lbTarget) lxc.target = opts.lbTarget;
  return {
    apiVersion: "cluster.x-k8s.io/v1beta2",
    kind: "Cluster",
    metadata: { name: c.name, namespace: c.namespace, labels: { "capn.cluster.x-k8s.io/deploy-kube-flannel": "true", "incuscloud.io/k8s-id": c.id } },
    spec: {
      clusterNetwork: { pods: { cidrBlocks: ["10.244.0.0/16"] }, services: { cidrBlocks: ["10.96.0.0/12"] }, serviceDomain: "cluster.local" },
      // Reachable from the management cluster and the nodes: a network forward to the load balancer.
      controlPlaneEndpoint: { host: c.endpointHost, port: c.endpointPort },
      topology: {
        classRef: { name: CLASS_NAME, namespace: CLASS_NAMESPACE },
        version: c.version,
        controlPlane: { replicas: c.controlPlanes },
        variables: [
          { name: "secretRef", value: c.secretName },
          { name: "privileged", value: false },
          { name: "loadBalancer", value: { lxc } },
          {
            name: "instance",
            value: { type: "container", flavor: SIZES[c.size].flavor, profiles: ["default"], devices: [], image: "", installKubeadm: false, target: "" },
          },
        ],
        workers: { machineDeployments: [{ class: "default-worker", name: "md-0", replicas: c.workers }] },
      },
    },
  };
}
