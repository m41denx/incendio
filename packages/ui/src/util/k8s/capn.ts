import { dump } from "js-yaml";

// Pure, client-side generators for CAPN (cluster-api-provider-incus) artifacts.
// Targets CAPI 0.9.x+ and the current Incus provider using the default
// (ClusterClass) template only. See docs/k8s/capn-reference.md for the pinned
// contract these produce.

// Available kubeadm images on the default capn simplestreams remote
// (images.linuxcontainers.org/capn), Ubuntu 24.04, amd64 + arm64. Refresh this
// list when new kubeadm images ship upstream. Newest first.
export const KUBEADM_VERSIONS = [
  "v1.37.0",
  "v1.36.4",
  "v1.36.1",
  "v1.35.5",
  "v1.35.0",
  "v1.34.0",
  "v1.33.5",
  "v1.33.0",
] as const;

export const DEFAULT_KUBEADM_VERSION = KUBEADM_VERSIONS[0];

export const kubeadmVersionOptions: { label: string; value: string }[] =
  KUBEADM_VERSIONS.map((version) => ({ label: version, value: version }));

// Sentinel select value that unlocks a free-text version + image-name field so
// users can point at a custom node image instead of a prebuilt kubeadm image.
export const CUSTOM_VERSION = "custom";

export const kubeadmVersionSelectOptions: { label: string; value: string }[] = [
  ...kubeadmVersionOptions,
  { label: "Custom image…", value: CUSTOM_VERSION },
];

export const isPresetKubeadmVersion = (version: string): boolean =>
  (KUBEADM_VERSIONS as readonly string[]).includes(version);

export type LoadBalancerType = "lxc" | "oci" | "kube-vip" | "ovn";
export type MachineType = "container" | "virtual-machine";
export type MemoryUnit = "GB" | "MB";

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
  imageName: string;
  secretName: string;
  // Load balancer (control-plane endpoint strategy).
  loadBalancer: LoadBalancerType;
  lbProfiles: string;
  lbFlavor: string;
  lbHost: string;
  lbNetworkName: string;
  // Machines.
  controlPlaneCount: number;
  workerCount: number;
  controlPlaneType: MachineType;
  workerType: MachineType;
  controlPlaneCpu: number;
  controlPlaneMemory: number;
  controlPlaneMemoryUnit: MemoryUnit;
  controlPlaneCustomFlavor: boolean;
  controlPlaneFlavor: string;
  workerCpu: number;
  workerMemory: number;
  workerMemoryUnit: MemoryUnit;
  workerCustomFlavor: boolean;
  workerFlavor: string;
  controlPlaneProfiles: string;
  workerProfiles: string;
  controlPlaneTarget: string;
  workerTarget: string;
  // Cluster networking / bootstrap.
  privileged: boolean;
  deployKubeFlannel: boolean;
  installKubeadm: boolean;
  podCidr: string;
  serviceCidr: string;
}

export const defaultK8sClusterConfig: K8sClusterConfig = {
  clusterName: "c1",
  kubernetesVersion: DEFAULT_KUBEADM_VERSION,
  imageName: "",
  secretName: "lxc-secret",
  loadBalancer: "lxc",
  lbProfiles: "default",
  lbFlavor: "c1-m1",
  lbHost: "",
  lbNetworkName: "default",
  controlPlaneCount: 1,
  workerCount: 1,
  controlPlaneType: "container",
  workerType: "container",
  controlPlaneCpu: 2,
  controlPlaneMemory: 4,
  controlPlaneMemoryUnit: "GB",
  controlPlaneCustomFlavor: false,
  controlPlaneFlavor: "c2-m4",
  workerCpu: 2,
  workerMemory: 4,
  workerMemoryUnit: "GB",
  workerCustomFlavor: false,
  workerFlavor: "c2-m4",
  controlPlaneProfiles: "default",
  workerProfiles: "default",
  controlPlaneTarget: "",
  workerTarget: "",
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
    { label: "kube-vip (static pods on control plane)", value: "kube-vip" },
    { label: "OVN network load balancer", value: "ovn" },
  ];

export const machineTypeOptions: { label: string; value: MachineType }[] = [
  { label: "Container", value: "container" },
  { label: "Virtual machine", value: "virtual-machine" },
];

export const memoryUnitOptions: { label: string; value: MemoryUnit }[] = [
  { label: "GB", value: "GB" },
  { label: "MB", value: "MB" },
];

const parseList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

// Convert CPU + memory into CAPN's `c<cores>-m<GiB>` flavor shorthand.
export const flavorFromResources = (
  cpu: number,
  memory: number,
  unit: MemoryUnit,
): string => {
  const gib = unit === "GB" ? memory : memory / 1024;
  const rounded = Number.isInteger(gib) ? gib : Number(gib.toFixed(2));
  return `c${cpu}-m${rounded}`;
};

// The flavor string that ends up in the manifest: either the free-text custom
// value (which also allows AWS-style names like `t3.medium`) or the computed
// `cX-mY` shorthand.
export const resolveFlavor = (
  custom: boolean,
  flavor: string,
  cpu: number,
  memory: number,
  unit: MemoryUnit,
): string => (custom ? flavor.trim() : flavorFromResources(cpu, memory, unit));

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

// Build the single-key YAML map for LOAD_BALANCER with the fields each strategy
// actually needs (see capn-reference.md §3.1).
const buildLoadBalancer = (config: K8sClusterConfig): string => {
  if (config.loadBalancer === "kube-vip") {
    return `kube-vip: {host: ${config.lbHost}}`;
  }
  if (config.loadBalancer === "ovn") {
    return `ovn: {host: ${config.lbHost}, networkName: ${config.lbNetworkName}}`;
  }
  // lxc | oci
  const profiles = `[${parseList(config.lbProfiles).join(", ")}]`;
  return `${config.loadBalancer}: {profiles: ${profiles}, flavor: ${config.lbFlavor}}`;
};

/**
 * CAPN template variables for a cluster, as raw (unquoted) values. Shared by
 * the copy/paste preview and the agent's create call so what the form shows is
 * exactly what gets applied. LXC_SECRET_NAME is left out: the agent owns the
 * identity secret it creates, and the preview adds the user's own name.
 */
export const buildTemplateVariables = (
  config: K8sClusterConfig,
): Record<string, string> => {
  const vars: Record<string, string> = {
    CLUSTER_NAME: config.clusterName,
    KUBERNETES_VERSION: config.kubernetesVersion,
    LOAD_BALANCER: buildLoadBalancer(config),
    CONTROL_PLANE_MACHINE_COUNT: String(config.controlPlaneCount),
    WORKER_MACHINE_COUNT: String(config.workerCount),
    CONTROL_PLANE_MACHINE_TYPE: config.controlPlaneType,
    WORKER_MACHINE_TYPE: config.workerType,
    CONTROL_PLANE_MACHINE_FLAVOR: resolveFlavor(
      config.controlPlaneCustomFlavor,
      config.controlPlaneFlavor,
      config.controlPlaneCpu,
      config.controlPlaneMemory,
      config.controlPlaneMemoryUnit,
    ),
    WORKER_MACHINE_FLAVOR: resolveFlavor(
      config.workerCustomFlavor,
      config.workerFlavor,
      config.workerCpu,
      config.workerMemory,
      config.workerMemoryUnit,
    ),
  };

  const controlPlaneProfiles = parseList(config.controlPlaneProfiles);
  if (
    controlPlaneProfiles.length > 0 &&
    controlPlaneProfiles.join(",") !== "default"
  ) {
    vars.CONTROL_PLANE_MACHINE_PROFILES = `[${controlPlaneProfiles.join(", ")}]`;
  }
  const workerProfiles = parseList(config.workerProfiles);
  if (workerProfiles.length > 0 && workerProfiles.join(",") !== "default") {
    vars.WORKER_MACHINE_PROFILES = `[${workerProfiles.join(", ")}]`;
  }
  if (config.controlPlaneTarget.trim().length > 0) {
    vars.CONTROL_PLANE_MACHINE_TARGET = config.controlPlaneTarget.trim();
  }
  if (config.workerTarget.trim().length > 0) {
    vars.WORKER_MACHINE_TARGET = config.workerTarget.trim();
  }

  vars.PRIVILEGED = String(config.privileged);
  vars.DEPLOY_KUBE_FLANNEL = String(config.deployKubeFlannel);
  if (config.installKubeadm) {
    vars.INSTALL_KUBEADM = "true";
  }
  if (config.imageName.trim().length > 0) {
    vars.LXC_IMAGE_NAME = config.imageName.trim();
  }
  vars.POD_CIDR = `[${config.podCidr}]`;
  vars.SERVICE_CIDR = `[${config.serviceCidr}]`;
  return vars;
};

// Shell quoting for the preview only: single quotes around YAML maps, double
// quotes around free-text targets.
const QUOTED: Partial<Record<string, "'" | '"'>> = {
  LOAD_BALANCER: "'",
  CONTROL_PLANE_MACHINE_TARGET: '"',
  WORKER_MACHINE_TARGET: '"',
};

/** The `export VAR=...` block consumed by `clusterctl generate cluster`. */
export const generateEnvExports = (config: K8sClusterConfig): string => {
  const { CLUSTER_NAME, KUBERNETES_VERSION, ...rest } =
    buildTemplateVariables(config);
  const ordered: [string, string][] = [
    ["CLUSTER_NAME", CLUSTER_NAME],
    ["KUBERNETES_VERSION", KUBERNETES_VERSION],
    ["LXC_SECRET_NAME", config.secretName],
    ...Object.entries(rest),
  ];
  return ordered
    .map(([key, value]) => {
      const quote = QUOTED[key] ?? "";
      return `export ${key}=${quote}${value}${quote}`;
    })
    .join("\n");
};

/** The prefilled `clusterctl generate cluster` command. */
export const generateClusterctlCommand = (config: K8sClusterConfig): string => {
  const parts = [
    `clusterctl generate cluster ${config.clusterName} -i incus`,
    `--kubernetes-version ${config.kubernetesVersion}`,
    `--control-plane-machine-count ${config.controlPlaneCount}`,
    `--worker-machine-count ${config.workerCount}`,
  ];
  return parts.join(" \\\n  ") + " \\\n  > cluster.yaml";
};

/** Management-cluster prerequisites (run on the user's clusterctl host). */
export const generatePrerequisites = (): string =>
  [
    "# 1. Register the CAPN provider with clusterctl",
    "mkdir -p ~/.cluster-api",
    "curl -o ~/.cluster-api/clusterctl.yaml \\",
    "  https://capn.linuxcontainers.org/static/v0.1/clusterctl.yaml",
    "",
    "# 2. Initialize the provider (the default template uses a ClusterClass,",
    "#    so the ClusterTopology feature gate must be enabled)",
    "CLUSTER_TOPOLOGY=true clusterctl init -i incus",
    "",
    "# 3. Apply the infrastructure credentials Secret",
    "kubectl apply -f secret.yaml",
    "",
    "# 4. Set the cluster variables, generate the manifest and apply it",
    "#    (see the exported variables and clusterctl command above)",
    "kubectl apply -f cluster.yaml",
  ].join("\n");
