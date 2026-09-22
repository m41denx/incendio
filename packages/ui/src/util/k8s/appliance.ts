// Deploy-management flow (docs/k8s/management-appliance.md §4). Hosts have no
// KVM, so the CAPI/CAPN management plane is a privileged, nested Incus
// CONTAINER running single-node k3s. The agent cannot create itself
// (chicken-and-egg), so the Incendio SPA creates the container directly over
// the Incus API, then hands off to the pinned bootstrap script via cloud-init.
//
// This module is transport-only: it builds the instance + cloud-init, drives
// the create/start/poll sequence, and persists the agent handle in Incus
// server config. All Kubernetes lifecycle stays in the agent/CAPN.

import { createInstance, fetchInstance, startInstance } from "api/instances";
import { createProject } from "api/projects";
import { fetchProfile } from "api/profiles";
import { fetchStoragePools } from "api/storage-pools";
import { fetchNetworks } from "api/networks";
import { waitForOperation } from "api/operations";
import { updateSettings } from "api/server";
import { saveAgentConfig } from "util/k8s/agent";
import { trustApplianceCertificate } from "util/k8s/trust";
import type { LxdInstance } from "types/instance";
import type { LxdDevices } from "types/device";
import type { LxdNetwork } from "types/network";
import type { LxdProfile } from "types/profile";
import type { LxdStoragePool } from "types/storage";
import type { LxdSettings } from "types/server";

export const MGMT_PROJECT = "incendio-mgmt";
export const APPLIANCE_NAME = "k8s-manager";
export const AGENT_PORT = 8843;
/** Incus server config key holding the agent handle (docs §5). */
export const API_CONFIG_KEY = "user.k8s.api-config";
/** GitHub Releases source of the pinned bootstrap script + k8s-api binary. */
export const BOOTSTRAP_REPO = "m41denx/incendio";
export const DEFAULT_BOOTSTRAP_TAG = "appliance-v1";

const PROJECT_KEYS = {
  managed: "user.incendio.managed",
  role: "user.incendio.role",
} as const;

const APPLIANCE_IMAGE = {
  protocol: "simplestreams",
  server: "https://images.linuxcontainers.org",
  // The "cloud" variant: the default images: variant has no cloud-init, so the
  // bootstrap user-data would be silently ignored.
  alias: "ubuntu/24.04/cloud",
} as const;

const CONF_DIR = "/etc/incendio";

// The appliance runs single-node k3s + CAPI/CAPN + the agent, so size it on its
// own defaults rather than any workload cluster the user happens to configure.
const APPLIANCE_DEFAULT_CPU = 2;
const APPLIANCE_DEFAULT_MEMORY = "4GiB";

/** How the agent (inside the container) authenticates to the Incus API. */
export interface IncusCredentials {
  /** Incus HTTPS API URL reachable from inside the container. */
  incusApiUrl: string;
  clientCrt: string;
  clientKey: string;
  serverCrt: string;
}

/** Optional overrides for the appliance container sizing. */
export interface ApplianceResources {
  cpu?: number;
  memory?: string;
}

export interface ApplianceDeployInput {
  credentials: IncusCredentials;
  /** Incus project to create the appliance in (ensured; usually MGMT_PROJECT). */
  project?: string;
  isFineGrained: boolean | null;
  /** Optional Incus cluster member to place the container on. */
  target?: string;
  /** Host address the browser reaches the agent proxy on. */
  agentHost?: string;
  bootstrapRepo?: string;
  bootstrapTag?: string;
  /** Optional overrides for the appliance container sizing. */
  resources?: ApplianceResources;
}

export interface DeployedAppliance {
  url: string;
  token: string;
  project: string;
  name: string;
  /** Container address once running, or null if not observed before timeout. */
  address: string | null;
}

export interface ApiConfig {
  url: string;
  token: string;
  fingerprint?: string | null;
}

interface CloudInitInput {
  token: string;
  jwtSecret: string;
  corsOrigin: string;
  agentHost: string;
  credentials: IncusCredentials;
  repo: string;
  tag: string;
}

interface InstanceInput {
  cloudInit: string;
  cpu: number;
  memory: string;
  /** Root disk / NIC the inherited default profile does not provide. */
  devices?: LxdDevices;
}

const hexSecret = (bytes = 24): string => {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** Agent URL the browser uses to reach the appliance through the proxy device. */
export const managementAgentUrl = (host: string): string =>
  `https://${host}:${AGENT_PORT}`;

const incusApiUrlFor = (input: CloudInitInput): string =>
  input.credentials.incusApiUrl.trim().length > 0
    ? input.credentials.incusApiUrl.trim()
    : `https://${input.agentHost}:8443`;

const agentEnvFile = (input: CloudInitInput): string =>
  [
    "HOST=0.0.0.0",
    `PORT=${AGENT_PORT}`,
    `AGENT_TOKEN=${input.token}`,
    `JWT_SECRET=${input.jwtSecret}`,
    `CORS_ORIGIN=${input.corsOrigin}`,
    `INCUS_API_URL=${incusApiUrlFor(input)}`,
    `INCUS_CLIENT_CERT=${CONF_DIR}/client.crt`,
    `INCUS_CLIENT_KEY=${CONF_DIR}/client.key`,
    `INCUS_SERVER_CERT=${CONF_DIR}/server.crt`,
    `DB_PATH=/opt/incendio/incendio-k8s.sqlite`,
    `TLS_CERT_FILE=${CONF_DIR}/agent-tls.crt`,
    `TLS_KEY_FILE=${CONF_DIR}/agent-tls.key`,
    `AGENT_TLS_SAN=${input.agentHost}`,
    "",
  ].join("\n");

// Emitted as #cloud-config + JSON (JSON is valid YAML, sidestepping PEM
// indentation pitfalls). cloud-init writes config, then runs the pinned
// bootstrap script which owns k3s/clusterctl/CAPN + the agent's TLS + systemd.
export const buildApplianceCloudInit = (input: CloudInitInput): string => {
  const scriptUrl = `https://github.com/${input.repo}/releases/download/${input.tag}/bootstrap.sh`;
  const cloudConfig = {
    write_files: [
      {
        path: `${CONF_DIR}/client.crt`,
        permissions: "0600",
        content: input.credentials.clientCrt,
      },
      {
        path: `${CONF_DIR}/client.key`,
        permissions: "0600",
        content: input.credentials.clientKey,
      },
      {
        path: `${CONF_DIR}/server.crt`,
        permissions: "0644",
        content: input.credentials.serverCrt,
      },
      {
        path: `${CONF_DIR}/agent.env`,
        permissions: "0600",
        content: agentEnvFile(input),
      },
    ],
    runcmd: [
      "mkdir -p /opt/incendio",
      `curl -fsSL -o /opt/incendio/bootstrap.sh ${scriptUrl}`,
      "chmod +x /opt/incendio/bootstrap.sh",
      `INCENDIO_RELEASE_REPO=${input.repo} INCENDIO_RELEASE_TAG=${input.tag} bash /opt/incendio/bootstrap.sh`,
    ],
  };
  return `#cloud-config\n${JSON.stringify(cloudConfig, null, 2)}\n`;
};

/** POST /1.0/instances body for the privileged, nested management container. */
export const buildApplianceInstance = (
  input: InstanceInput,
): Record<string, unknown> => ({
  name: APPLIANCE_NAME,
  type: "container",
  description:
    "Incendio Kubernetes management appliance (single-node k3s + CAPN + agent)",
  source: {
    type: "image",
    protocol: APPLIANCE_IMAGE.protocol,
    server: APPLIANCE_IMAGE.server,
    alias: APPLIANCE_IMAGE.alias,
  },
  config: {
    "security.nesting": "true",
    "security.privileged": "true",
    "limits.cpu": String(input.cpu),
    "limits.memory": input.memory,
    "cloud-init.user-data": input.cloudInit,
    [PROJECT_KEYS.managed]: "true",
    [PROJECT_KEYS.role]: "management",
  },
  devices: {
    ...input.devices,
    // Publish the agent's HTTPS port on the host so the browser can reach it.
    "k8s-api": {
      type: "proxy",
      listen: `tcp:0.0.0.0:${AGENT_PORT}`,
      connect: `tcp:127.0.0.1:${AGENT_PORT}`,
      bind: "host",
    },
  },
});

const hasDevice = (
  devices: LxdDevices,
  match: (device: Partial<Record<string, unknown>>) => boolean,
): boolean =>
  Object.values(devices).some((device) =>
    match(device as unknown as Partial<Record<string, unknown>>),
  );

// NAT bridges first (docs §3: the appliance only needs egress), then OVN.
const NETWORK_PREFERENCE = ["bridge", "ovn"];

/**
 * The appliance body only defines its proxy device and relies on the inherited
 * default profile for a root disk + NIC. That profile can be empty (Incus
 * initialised without a default pool/network; the UI's own instance form adds
 * the root disk per instance instead), which fails creation with "No root
 * device could be found". Fill in whatever the profile lacks.
 */
export const resolveApplianceDevices = (
  profile: LxdProfile,
  pools: LxdStoragePool[],
  networks: LxdNetwork[],
): LxdDevices => {
  const devices: LxdDevices = {};
  const inherited = profile.devices ?? {};

  if (!hasDevice(inherited, (d) => d.type === "disk" && d.path === "/")) {
    const pool = pools.find((p) => p.status === "Created") ?? pools[0];
    if (!pool) {
      throw new Error(
        "No storage pool available for the management appliance's root disk",
      );
    }
    devices.root = { type: "disk", path: "/", pool: pool.name };
  }

  if (!hasDevice(inherited, (d) => d.type === "nic")) {
    const usable = networks.filter(
      (n) =>
        n.managed === true &&
        NETWORK_PREFERENCE.includes(n.type) &&
        !!n.config?.["ipv4.address"] &&
        n.config["ipv4.address"] !== "none",
    );
    usable.sort(
      (a, b) =>
        NETWORK_PREFERENCE.indexOf(a.type) - NETWORK_PREFERENCE.indexOf(b.type),
    );
    const network = usable[0];
    if (!network) {
      throw new Error(
        "No managed NAT network available for the management appliance (needs internet egress)",
      );
    }
    devices.eth0 = { type: "nic", name: "eth0", network: network.name };
  }

  return devices;
};

const fetchApplianceDevices = async (
  project: string,
  isFineGrained: boolean | null,
): Promise<LxdDevices> => {
  const [profile, pools, networks] = await Promise.all([
    fetchProfile("default", project, isFineGrained),
    fetchStoragePools(isFineGrained, project),
    fetchNetworks(project, isFineGrained),
  ]);
  return resolveApplianceDevices(profile, pools, networks);
};

const firstGlobalIPv4 = (instance: LxdInstance): string | null => {
  const network = instance.state?.network;
  if (!network) return null;
  for (const iface of Object.keys(network)) {
    if (iface === "lo") continue;
    for (const addr of network[iface]?.addresses ?? []) {
      if (addr.family === "inet" && addr.scope === "global")
        return addr.address;
    }
  }
  return null;
};

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ensureProject = async (name: string): Promise<void> => {
  const body = JSON.stringify({
    name,
    description: "Incendio-managed Kubernetes management project",
    config: {
      "features.images": "true",
      // Inherit the default project's profiles so the single appliance
      // container gets a root disk + NIC. With features.profiles=true the
      // project gets its own empty default profile and instance creation
      // fails with "No root device could be found".
      "features.profiles": "false",
      [PROJECT_KEYS.managed]: "true",
      [PROJECT_KEYS.role]: "management",
    },
  });
  try {
    await createProject(body);
  } catch (error) {
    // Idempotent: tolerate a pre-existing management project.
    if (!/exist/i.test((error as Error).message ?? "")) throw error;
  }
};

const waitForApplianceAddress = async (
  project: string,
  isFineGrained: boolean | null,
  timeoutMs = 120000,
): Promise<string | null> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const instance = await fetchInstance(
        APPLIANCE_NAME,
        project,
        isFineGrained,
        false,
      );
      const address = firstGlobalIPv4(instance);
      if (address) return address;
    } catch {
      // Instance may not be queryable yet; keep polling.
    }
    await delay(3000);
  }
  return null;
};

/**
 * Create + start the management appliance and persist a provisional agent
 * handle. The agent serves a self-signed cert, so the browser cannot complete
 * the /v1/info handshake until the user approves it via the "Approve K8s
 * manager certificate" link; the fingerprint is filled in on first successful
 * connection (see finalizeApiConfig).
 */
export const deployManagementAppliance = async (
  input: ApplianceDeployInput,
): Promise<DeployedAppliance> => {
  const project = input.project ?? MGMT_PROJECT;
  const agentHost = input.agentHost ?? globalThis.location.hostname;
  const token = hexSecret();
  const jwtSecret = hexSecret();
  const repo = input.bootstrapRepo ?? BOOTSTRAP_REPO;
  const tag = input.bootstrapTag ?? DEFAULT_BOOTSTRAP_TAG;

  // The agent reaches Incus with this cert; trust it up front so the appliance
  // can create cluster projects as soon as it is up.
  await trustApplianceCertificate(input.credentials.clientCrt);
  await ensureProject(project);
  const devices = await fetchApplianceDevices(project, input.isFineGrained);

  const cloudInit = buildApplianceCloudInit({
    token,
    jwtSecret,
    corsOrigin: globalThis.location.origin,
    agentHost,
    credentials: input.credentials,
    repo,
    tag,
  });
  const body = JSON.stringify(
    buildApplianceInstance({
      cloudInit,
      cpu:
        input.resources?.cpu && input.resources.cpu > 0
          ? input.resources.cpu
          : APPLIANCE_DEFAULT_CPU,
      memory: input.resources?.memory?.trim() || APPLIANCE_DEFAULT_MEMORY,
      devices,
    }),
  );

  const createOp = await createInstance(body, project, input.target);
  await waitForOperation(createOp.metadata.id);

  const created = await fetchInstance(
    APPLIANCE_NAME,
    project,
    input.isFineGrained,
    false,
  );
  const startOp = await startInstance(created);
  await waitForOperation(startOp.metadata.id);

  const address = await waitForApplianceAddress(project, input.isFineGrained);
  const url = managementAgentUrl(agentHost);

  await persistApiConfig({ url, token, fingerprint: null });
  saveAgentConfig({ url, token });

  return { url, token, project, name: APPLIANCE_NAME, address };
};

/** Write the agent handle into Incus server config (docs §5). */
export const persistApiConfig = async (config: ApiConfig): Promise<void> => {
  await updateSettings({ [API_CONFIG_KEY]: JSON.stringify(config) });
};

/**
 * Update the stored handle with the cert fingerprint learned on a successful
 * handshake. Best-effort: pinning is advisory for the self-signed appliance.
 */
export const finalizeApiConfig = async (
  url: string,
  token: string,
  fingerprint: string | null,
): Promise<void> => {
  await persistApiConfig({ url, token, fingerprint });
};

/** Read the persisted agent handle out of loaded Incus server settings. */
export const readApiConfig = (
  settings: LxdSettings | null | undefined,
): ApiConfig | null => {
  const raw = settings?.config?.[API_CONFIG_KEY];
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as ApiConfig;
  } catch {
    return null;
  }
};
