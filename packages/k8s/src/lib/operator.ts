import { incusClient } from "./incus.ts";
import { PROJECT_KEYS } from "./projects.ts";

// Builds the day-0 artifacts for the operator appliance VM: the vCenter/VCSA of
// our model. The VM is created via the *plain* Incus API (no CAPI exists yet —
// the unavoidable chicken-and-egg), boots a kubeadm VM image, and cloud-init
// installs the trusted Incus client cert + the incendio agent as a systemd
// service. The agent then bootstraps the management cluster itself; we keep the
// heavy kubeadm/clusterctl logic in the agent, not in cloud-init, so Incus
// hosts stay pure. See docs/k8s/deploy-model.md §4.

export interface OperatorVmSpec {
  /** Operator VM instance name (cosmetic; detection uses project metadata). */
  name: string;
  /** Management project the VM lives in. */
  project: string;
  /** Kubernetes version, used to pick the kubeadm image, e.g. "v1.37.0". */
  kubernetesVersion: string;
  /** simplestreams image alias; defaults to `kubeadm/<kubernetesVersion>`. */
  imageAlias?: string;
  /** simplestreams server hosting the kubeadm images (the `capi` remote). */
  imageServer?: string;
  cpu?: number;
  memoryGiB?: number;
  /** Optional Incus cluster member to place the VM on. */
  target?: string;

  // --- material injected into the VM via cloud-init ---
  /** Bearer token the UI will present to the agent. */
  agentToken: string;
  /** Secret the agent uses to sign JWTs. */
  jwtSecret: string;
  /** Browser origin(s) allowed to call the agent (CORS), or "*". */
  corsOrigin: string;
  /** How the agent reaches the Incus API from inside the VM. */
  incusApiUrl: string;
  /** Trusted Incus client certificate PEM (same material as `lxc-secret`). */
  clientCrt: string;
  /** Client private key PEM. */
  clientKey: string;
  /** Incus server certificate PEM (TLS pin). */
  serverCrt: string;
  /** Where cloud-init pulls the agent binary; omit if baked into the image. */
  agentDownloadUrl?: string;
}

const DEFAULT_IMAGE_SERVER = "https://images.linuxcontainers.org/capn";
const AGENT_BIN = "/usr/local/bin/incendio-k8s";
const CONF_DIR = "/etc/incendio";

function agentEnvFile(spec: OperatorVmSpec): string {
  return [
    "HOST=0.0.0.0",
    "PORT=8443",
    `AGENT_TOKEN=${spec.agentToken}`,
    `JWT_SECRET=${spec.jwtSecret}`,
    `CORS_ORIGIN=${spec.corsOrigin}`,
    `INCUS_API_URL=${spec.incusApiUrl}`,
    `INCUS_CLIENT_CERT=${CONF_DIR}/client.crt`,
    `INCUS_CLIENT_KEY=${CONF_DIR}/client.key`,
    "",
  ].join("\n");
}

const SYSTEMD_UNIT = [
  "[Unit]",
  "Description=Incendio Kubernetes agent",
  "After=network-online.target",
  "Wants=network-online.target",
  "",
  "[Service]",
  `EnvironmentFile=${CONF_DIR}/agent.env`,
  `ExecStart=${AGENT_BIN}`,
  "Restart=on-failure",
  "RestartSec=2",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
  "",
].join("\n");

/**
 * Build cloud-init user-data. Emitted as `#cloud-config` + JSON (JSON is valid
 * YAML, which sidesteps PEM indentation bugs).
 */
export function buildCloudInit(spec: OperatorVmSpec): string {
  const cloudConfig = {
    write_files: [
      { path: `${CONF_DIR}/client.crt`, permissions: "0600", content: spec.clientCrt },
      { path: `${CONF_DIR}/client.key`, permissions: "0600", content: spec.clientKey },
      { path: `${CONF_DIR}/server.crt`, permissions: "0644", content: spec.serverCrt },
      { path: `${CONF_DIR}/agent.env`, permissions: "0600", content: agentEnvFile(spec) },
      {
        path: "/etc/systemd/system/incendio-k8s.service",
        permissions: "0644",
        content: SYSTEMD_UNIT,
      },
    ],
    runcmd: [
      ...(spec.agentDownloadUrl
        ? [
            `curl -fsSL -o ${AGENT_BIN} ${spec.agentDownloadUrl}`,
            `chmod +x ${AGENT_BIN}`,
          ]
        : []),
      "systemctl daemon-reload",
      "systemctl enable --now incendio-k8s.service",
    ],
  };
  return `#cloud-config\n${JSON.stringify(cloudConfig, null, 2)}\n`;
}

/** Build the Incus POST /1.0/instances body for the operator VM. */
export function buildOperatorInstance(spec: OperatorVmSpec): Record<string, unknown> {
  return {
    name: spec.name,
    type: "virtual-machine",
    description: "Incendio operator appliance (management cluster + agent)",
    source: {
      type: "image",
      protocol: "simplestreams",
      server: spec.imageServer ?? DEFAULT_IMAGE_SERVER,
      alias: spec.imageAlias ?? `kubeadm/${spec.kubernetesVersion}`,
    },
    config: {
      "limits.cpu": String(spec.cpu ?? 2),
      "limits.memory": `${spec.memoryGiB ?? 4}GiB`,
      "cloud-init.user-data": buildCloudInit(spec),
      [PROJECT_KEYS.managed]: "true",
      [PROJECT_KEYS.role]: "management",
    },
  };
}

/**
 * Create the operator VM via the plain Incus API. Returns the async operation
 * payload Incus responds with; the caller polls the operation to completion.
 */
export async function createOperatorVm(spec: OperatorVmSpec): Promise<unknown> {
  const client = incusClient();
  const params = new URLSearchParams({ project: spec.project });
  if (spec.target) params.set("target", spec.target);
  const { data } = await client.post(
    `/1.0/instances?${params.toString()}`,
    buildOperatorInstance(spec),
  );
  return data;
}
