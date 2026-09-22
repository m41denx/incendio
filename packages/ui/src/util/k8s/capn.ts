import { dump } from "js-yaml";

// Pure, client-side generators for CAPN (cluster-api-provider-incus) artifacts.
// See docs/k8s/capn-reference.md for the pinned contract these produce.

export type K8sFlavor = "default" | "ovn";
export type LoadBalancerType = "lxc" | "oci" | "kube-vip" | "ovn";
export type MachineType = "container" | "virtual-machine" | "kind";

export interface IncusClientCredential {
  crt: string;
  key: string;
}

export interface IncusCredentials {
  server: string;
  serverCrt: string;
  clientCrt: string;
  clientKey: string;
  project: string;
}

export interface K8sClusterConfig {
  clusterName: string;
  kubernetesVersion: string;
  flavor: K8sFlavor;
  secretName: string;
  loadBalancer: LoadBalancerType;
  ovnNetwork: string;
  ovnLoadBalancerAddress: string;
  controlPlaneCount: number;
  workerCount: number;
  controlPlaneType: MachineType;
  workerType: MachineType;
  controlPlaneFlavor: string;
  workerFlavor: string;
  imageName: string;
  privileged: boolean;
  deployKubeFlannel: boolean;
  installKubeadm: boolean;
  podCidr: string;
  serviceCidr: string;
}

export const defaultK8sClusterConfig: K8sClusterConfig = {
  clusterName: "c1",
  kubernetesVersion: "v1.31.0",
  flavor: "default",
  secretName: "lxc-secret",
  loadBalancer: "lxc",
  ovnNetwork: "ovn0",
  ovnLoadBalancerAddress: "10.100.42.1",
  controlPlaneCount: 1,
  workerCount: 1,
  controlPlaneType: "container",
  workerType: "container",
  controlPlaneFlavor: "c2-m4",
  workerFlavor: "c2-m4",
  imageName: "",
  privileged: true,
  deployKubeFlannel: true,
  installKubeadm: false,
  podCidr: "10.244.0.0/16",
  serviceCidr: "10.96.0.0/12",
};

export const loadBalancerOptions: { label: string; value: LoadBalancerType }[] =
  [
    { label: "LXC container (haproxy) — good for dev", value: "lxc" },
    { label: "OCI container (haproxy)", value: "oci" },
    { label: "kube-vip (VIP 10.0.42.1)", value: "kube-vip" },
    { label: "OVN network load balancer", value: "ovn" },
  ];

export const machineTypeOptions: { label: string; value: MachineType }[] = [
  { label: "Container", value: "container" },
  { label: "Virtual machine", value: "virtual-machine" },
  { label: "kind", value: "kind" },
];

/** Render the infrastructure-credentials Secret CAPN reads (LXC_SECRET_NAME). */
export const generateSecretYaml = (
  secretName: string,
  creds: IncusCredentials,
): string =>
  dump(
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName },
      type: "Opaque",
      stringData: {
        server: creds.server,
        "server-crt": creds.serverCrt.trim() + "\n",
        "client-crt": creds.clientCrt.trim() + "\n",
        "client-key": creds.clientKey.trim() + "\n",
        project: creds.project,
      },
    },
    { lineWidth: -1, noRefs: true },
  );

const loadBalancerValue = (lb: LoadBalancerType): string => `${lb}: {}`;

/** The `export VAR=...` block consumed by `clusterctl generate cluster`. */
export const generateEnvExports = (config: K8sClusterConfig): string => {
  const lines: string[] = [
    `export CLUSTER_NAME=${config.clusterName}`,
    `export KUBERNETES_VERSION=${config.kubernetesVersion}`,
    `export LXC_SECRET_NAME=${config.secretName}`,
  ];

  if (config.flavor === "default") {
    lines.push(
      `export LOAD_BALANCER='${loadBalancerValue(config.loadBalancer)}'`,
    );
  } else {
    lines.push(
      `export LXC_LOAD_BALANCER_ADDRESS=${config.ovnLoadBalancerAddress}`,
    );
    lines.push(`export LXC_LOAD_BALANCER_NETWORK=${config.ovnNetwork}`);
  }

  lines.push(
    `export CONTROL_PLANE_MACHINE_COUNT=${config.controlPlaneCount}`,
    `export WORKER_MACHINE_COUNT=${config.workerCount}`,
    `export CONTROL_PLANE_MACHINE_TYPE=${config.controlPlaneType}`,
    `export WORKER_MACHINE_TYPE=${config.workerType}`,
    `export CONTROL_PLANE_MACHINE_FLAVOR=${config.controlPlaneFlavor}`,
    `export WORKER_MACHINE_FLAVOR=${config.workerFlavor}`,
  );

  if (config.flavor === "default") {
    lines.push(`export PRIVILEGED=${String(config.privileged)}`);
    lines.push(
      `export DEPLOY_KUBE_FLANNEL=${String(config.deployKubeFlannel)}`,
    );
  }
  if (config.installKubeadm) {
    lines.push(`export INSTALL_KUBEADM=true`);
  }
  if (config.imageName.trim().length > 0) {
    lines.push(`export LXC_IMAGE_NAME=${config.imageName.trim()}`);
  }
  lines.push(
    `export POD_CIDR=[${config.podCidr}]`,
    `export SERVICE_CIDR=[${config.serviceCidr}]`,
  );

  return lines.join("\n");
};

/** The prefilled `clusterctl generate cluster` command. */
export const generateClusterctlCommand = (config: K8sClusterConfig): string => {
  const parts = [
    `clusterctl generate cluster ${config.clusterName} -i incus`,
    config.flavor === "ovn" ? "--flavor ovn" : "",
    `--kubernetes-version ${config.kubernetesVersion}`,
    `--control-plane-machine-count ${config.controlPlaneCount}`,
    `--worker-machine-count ${config.workerCount}`,
  ].filter((part) => part.length > 0);
  return parts.join(" \\\n  ") + " \\\n  > cluster.yaml";
};

/** Management-cluster prerequisites (run on the user's clusterctl host). */
export const generatePrerequisites = (config: K8sClusterConfig): string =>
  [
    "# 1. Register the CAPN provider with clusterctl",
    "mkdir -p ~/.cluster-api",
    "curl -o ~/.cluster-api/clusterctl.yaml \\",
    "  https://capn.linuxcontainers.org/static/v0.1/clusterctl.yaml",
    "",
    "# 2. Initialize the provider on your management cluster",
    config.flavor === "default"
      ? "#    (the default flavor uses a ClusterClass, so enable the topology gate)"
      : "#    (the ovn flavor renders plain manifests)",
    `${config.flavor === "default" ? "CLUSTER_TOPOLOGY=true " : ""}clusterctl init -i incus`,
    "",
    "# 3. Apply the infrastructure credentials Secret",
    "kubectl apply -f secret.yaml",
    "",
    "# 4. Set the cluster variables, generate the manifest and apply it",
    "#    (see the exported variables and clusterctl command above)",
    "kubectl apply -f cluster.yaml",
  ].join("\n");
