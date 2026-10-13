import type { K8sCluster, K8sOptions, K8sSpec } from "../../api/types";

/** A medium cluster's spec, as the API's defaults. */
export const k8sSpec = (over: Partial<K8sSpec> = {}): K8sSpec => ({
  controlPlane: { type: "container", flavor: "c2-m4", profiles: ["default"], target: "" },
  worker: { type: "container", flavor: "c2-m4", profiles: ["default"], target: "" },
  loadBalancer: { type: "lxc", flavor: "c1-m1", profiles: ["default"], target: "" },
  image: "",
  privileged: false,
  flannel: true,
  installKubeadm: false,
  podCidr: "10.244.0.0/16",
  serviceCidr: "10.96.0.0/12",
  metallb: null,
  ...over,
});

export const k8sOptions = (enabled = true): K8sOptions => ({
  enabled,
  versions: ["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"],
  sizes: { small: { cpu: 2, memoryGiB: 2 }, medium: { cpu: 2, memoryGiB: 4 }, large: { cpu: 4, memoryGiB: 8 } },
  defaults: k8sSpec(),
});

export const k8sCluster = (over: Partial<K8sCluster> = {}): K8sCluster => ({
  id: "k-1",
  tenantId: "t-1",
  tenantSlug: "acme",
  clusterId: "c-1",
  clusterName: "lab",
  project: "acme",
  member: "",
  name: "web",
  version: "v1.36.4",
  controlPlanes: 1,
  workers: 2,
  size: null,
  spec: k8sSpec(),
  endpoint: "https://10.0.0.5:16443",
  status: "ready",
  statusMessage: "",
  nodes: 3,
  nodesReady: 3,
  createdBy: "u-1",
  createdAt: "2026-10-12T10:00:00Z",
  syncedAt: "2026-10-12T10:05:00Z",
  ...over,
});
