// The Kubernetes management appliance: a privileged, nested Incus container
// running single-node k3s + Cluster API + CAPN + the Incendio agent
// (docs/k8s/management-appliance.md). A port of the UI's deploy flow and
// staged readiness checks (packages/ui/src/util/k8s/{appliance,management}.ts).

import type { CreateAxiosDefaults } from "axios";
import { IncusError } from "../api/base/types";
import type {
  DevicesMap,
  Network,
  Profile,
  StoragePool,
} from "../api/types/generated";
import type { IncusClient } from "../humane/Client";
import type { Instance } from "../humane/Instance";
import { certificateFingerprint, pemBody } from "../utils/certificates";
import { K8sAgentClient } from "./agent";
import { generateClientCredential, type ClientCredential } from "./credentials";
import type { AgentHandle, AgentInfo } from "./types";

export const MGMT_PROJECT = "incendio-mgmt";
export const APPLIANCE_NAME = "k8s-manager";
export const AGENT_PORT = 8843;
/** Incus server config key holding the agent handle. */
export const API_CONFIG_KEY = "user.k8s.api-config";
/** GitHub releases carrying the pinned bootstrap script + agent binaries. */
export const BOOTSTRAP_REPO = "m41denx/incendio";
export const DEFAULT_BOOTSTRAP_TAG = "appliance-v1";
const APPLIANCE_CERT_NAME = "incendio-k8s-appliance";

const CONF_DIR = "/etc/incendio";
export const APPLIANCE_PATHS = {
  clientCert: `${CONF_DIR}/client.crt`,
  agentTlsCert: `${CONF_DIR}/agent-tls.crt`,
  cloudInitResult: "/var/lib/cloud/data/result.json",
  cloudInitLog: "/var/log/cloud-init-output.log",
  cloudInitBin: "/usr/bin/cloud-init",
} as const;

const PROJECT_KEYS = {
  managed: "user.incendio.managed",
  role: "user.incendio.role",
} as const;

// The "cloud" variant: the default images: variant has no cloud-init, so the
// bootstrap user-data would be silently ignored.
const APPLIANCE_IMAGE = {
  type: "image",
  protocol: "simplestreams",
  server: "https://images.linuxcontainers.org",
  alias: "ubuntu/24.04/cloud",
} as const;

export type ManagementStage =
  | "not-deployed"
  | "stopped"
  | "bootstrapping"
  | "bootstrap-failed"
  | "connecting"
  | "agent-unreachable"
  | "capn-pending"
  | "incus-untrusted"
  | "ready";

export interface ManagementState {
  stage: ManagementStage;
  /** Clusters can be created. */
  ready: boolean;
  title: string;
  message: string;
  /** Agent handshake, once reachable. */
  agent?: AgentInfo;
  /** cloud-init errors, for `bootstrap-failed`. */
  errors?: string[];
}

export interface CloudInitResult {
  /** Every cloud-init stage (incl. the bootstrap runcmd) has run. */
  done: boolean;
  errors: string[];
}

export interface DeployApplianceOptions {
  /**
   * Host the agent is reached on (a host proxy publishes :8843).
   * Default: the page's hostname in browsers, else the Incus client's host,
   * else the daemon's first non-loopback address.
   */
  agentHost?: string;
  /** Incus API URL reachable from inside the appliance. Default: the daemon's first non-loopback address. */
  incusApiUrl?: string;
  /** Client certificate the agent (and CAPN) use for Incus. Default: generated (needs `node-forge`). */
  credentials?: ClientCredential;
  /** Browser origins allowed to call the agent. Default: the Incendio UI origin. */
  corsOrigin?: string;
  /** Incus cluster member for the container. */
  target?: string;
  /** Default 2. */
  cpu?: number;
  /** Default `4GiB`. */
  memory?: string;
  bootstrapRepo?: string;
  bootstrapTag?: string;
}

export interface WaitForApplianceOptions {
  /** Seconds (default 1200: first boot pulls k3s and the CAPI images). */
  timeout?: number;
  /** Poll interval in seconds (default 5). */
  interval?: number;
  /** Called whenever the stage changes. */
  onStage?: (state: ManagementState) => void;
  /** Add the appliance's certificate to the Incus trust store if missing (default false). */
  autoTrust?: boolean;
}

export type AgentTransport = (pin: {
  fingerprint: string;
}) => CreateAxiosDefaults;

const hexSecret = (bytes = 24): string => {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const state = (
  stage: ManagementStage,
  title: string,
  message: string,
  extra: Partial<ManagementState> = {},
): ManagementState => ({
  stage,
  ready: stage === "ready",
  title,
  message,
  ...extra,
});

const isLoopback = (host: string) =>
  host === "localhost" ||
  host.startsWith("127.") ||
  host === "::1" ||
  host === "[::1]";

/** First non-loopback IPv4 `host:port` the daemon listens on. */
const firstAddress = (addresses: string[] = []): string | undefined =>
  addresses.find((a) => !a.startsWith("[") && !isLoopback(a.split(":")[0]!));

// NAT bridges first (the appliance only needs egress), then OVN.
const NETWORK_PREFERENCE = ["bridge", "ovn"];

/**
 * Root disk + NIC the inherited default profile does not provide (it can be
 * empty when Incus was initialised without a default pool/network).
 */
export const resolveApplianceDevices = (
  profile: Profile,
  pools: StoragePool[],
  networks: Network[],
): DevicesMap => {
  const devices: DevicesMap = {};
  const inherited = Object.values(profile.devices ?? {});
  if (!inherited.some((d) => d.type === "disk" && d.path === "/")) {
    const pool = pools.find((p) => p.status === "Created") ?? pools[0];
    if (!pool)
      throw new Error(
        "No storage pool for the management appliance's root disk",
      );
    devices.root = { type: "disk", path: "/", pool: pool.name };
  }
  if (!inherited.some((d) => d.type === "nic")) {
    const network = networks
      .filter(
        (n) =>
          n.managed &&
          NETWORK_PREFERENCE.includes(n.type) &&
          !!n.config?.["ipv4.address"] &&
          n.config["ipv4.address"] !== "none",
      )
      .sort(
        (a, b) =>
          NETWORK_PREFERENCE.indexOf(a.type) -
          NETWORK_PREFERENCE.indexOf(b.type),
      )[0];
    if (!network) {
      throw new Error(
        "No managed NAT network for the management appliance (it needs internet egress)",
      );
    }
    devices.eth0 = { type: "nic", name: "eth0", network: network.name };
  }
  return devices;
};

interface CloudInitInput {
  token: string;
  jwtSecret: string;
  corsOrigin: string;
  agentHost: string;
  incusApiUrl: string;
  credentials: ClientCredential;
  serverCrt: string;
  repo: string;
  tag: string;
}

/** `#cloud-config` that writes the agent config and runs the pinned bootstrap script. */
export const buildApplianceCloudInit = (input: CloudInitInput): string => {
  const env = [
    "HOST=0.0.0.0",
    `PORT=${AGENT_PORT}`,
    `AGENT_TOKEN=${input.token}`,
    `JWT_SECRET=${input.jwtSecret}`,
    `CORS_ORIGIN=${input.corsOrigin}`,
    `INCUS_API_URL=${input.incusApiUrl}`,
    `INCUS_CLIENT_CERT=${CONF_DIR}/client.crt`,
    `INCUS_CLIENT_KEY=${CONF_DIR}/client.key`,
    `INCUS_SERVER_CERT=${CONF_DIR}/server.crt`,
    "DB_PATH=/opt/incendio/incendio-k8s.sqlite",
    `TLS_CERT_FILE=${CONF_DIR}/agent-tls.crt`,
    `TLS_KEY_FILE=${CONF_DIR}/agent-tls.key`,
    `AGENT_TLS_SAN=${input.agentHost}`,
    "",
  ].join("\n");
  const scriptUrl = `https://github.com/${input.repo}/releases/download/${input.tag}/bootstrap.sh`;
  // JSON is valid YAML and sidesteps PEM indentation pitfalls.
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
        content: input.serverCrt,
      },
      { path: `${CONF_DIR}/agent.env`, permissions: "0600", content: env },
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

/**
 * The management appliance: deploy it, follow its bring-up, trust it, and
 * connect to its agent.
 */
export class ManagementAppliance {
  readonly project: string;
  readonly name: string;
  private readonly incus: IncusClient;
  private readonly agentTransport?: AgentTransport;

  constructor(
    incus: IncusClient,
    opts: {
      project?: string;
      name?: string;
      agentTransport?: AgentTransport;
    } = {},
  ) {
    this.incus = incus;
    this.project = opts.project ?? MGMT_PROJECT;
    this.name = opts.name ?? APPLIANCE_NAME;
    this.agentTransport = opts.agentTransport;
  }

  private get scoped(): IncusClient {
    return this.incus.useProject(this.project);
  }

  /** The appliance container, or null if not deployed. */
  async instance(): Promise<Instance | null> {
    try {
      return await this.scoped.getInstance(this.name);
    } catch (error) {
      if (error instanceof IncusError && error.isNotFound) return null;
      throw error;
    }
  }

  /** A text file inside the appliance, or null if it does not exist. */
  async readFile(path: string): Promise<string | null> {
    try {
      return await this.scoped.$api.instance(this.name).files.readText(path);
    } catch (error) {
      if (error instanceof IncusError && error.isNotFound) return null;
      throw error;
    }
  }

  /** Last lines of the bootstrap (cloud-init) output log. */
  async bootstrapLog(lines = 40): Promise<string> {
    const raw = (await this.readFile(APPLIANCE_PATHS.cloudInitLog)) ?? "";
    return raw.trimEnd().split("\n").slice(-lines).join("\n");
  }

  /** cloud-init progress, or null when it cannot be read. */
  async cloudInit(): Promise<CloudInitResult | null> {
    try {
      const raw = await this.readFile(APPLIANCE_PATHS.cloudInitResult);
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as { v1?: { errors?: unknown[] } };
          return { done: true, errors: (parsed.v1?.errors ?? []).map(String) };
        } catch {
          return { done: true, errors: ["unreadable cloud-init result"] };
        }
      }
      // No result yet: still running — unless cloud-init is not even there
      // (an image without it silently ignores the bootstrap user-data).
      const stat = await this.scoped.$api
        .instance(this.name)
        .files.stat(APPLIANCE_PATHS.cloudInitBin)
        .catch(() => null);
      return stat
        ? { done: false, errors: [] }
        : { done: true, errors: ["the appliance image has no cloud-init"] };
    } catch {
      return null;
    }
  }

  // ─── Agent handle ───────────────────────────────────────────────────────

  /** The stored agent handle (`user.k8s.api-config`), shared with the UI. */
  async handle(): Promise<AgentHandle | null> {
    const info = await this.incus.info();
    const raw = info.config?.[API_CONFIG_KEY];
    if (typeof raw !== "string" || !raw) return null;
    try {
      return JSON.parse(raw) as AgentHandle;
    } catch {
      return null;
    }
  }

  async saveHandle(handle: AgentHandle): Promise<void> {
    await this.incus.$api.server.patch({
      config: { [API_CONFIG_KEY]: JSON.stringify(handle) },
    });
  }

  /**
   * The agent's serving-certificate fingerprint, read from inside the
   * appliance over the (authenticated) Incus API — a pin that does not rely
   * on trusting the first TLS connection.
   */
  async agentFingerprint(): Promise<string | null> {
    const pem = await this.readFile(APPLIANCE_PATHS.agentTlsCert);
    return pem ? `sha256:${await certificateFingerprint(pem)}` : null;
  }

  /**
   * A client for the appliance's agent, from the stored handle. The handle's
   * fingerprint is filled in from the appliance when missing.
   */
  async agent(): Promise<K8sAgentClient> {
    const handle = await this.handle();
    if (!handle?.url || !handle.token) {
      throw new Error(
        `No Kubernetes agent configured (${API_CONFIG_KEY} is empty): deploy the management appliance first`,
      );
    }
    if (!handle.fingerprint) {
      const fingerprint = await this.agentFingerprint();
      if (fingerprint) {
        handle.fingerprint = fingerprint;
        await this.saveHandle(handle);
      }
    }
    return new K8sAgentClient({
      url: handle.url,
      token: handle.token,
      axios:
        this.agentTransport && handle.fingerprint
          ? this.agentTransport({ fingerprint: handle.fingerprint })
          : undefined,
    });
  }

  // ─── Trust ──────────────────────────────────────────────────────────────

  /** Whether Incus fully trusts the appliance's client certificate (null: unknown). */
  async isTrusted(): Promise<boolean | null> {
    const pem = await this.readFile(APPLIANCE_PATHS.clientCert).catch(
      () => null,
    );
    if (!pem) return null;
    return this.isCertificateTrusted(pem);
  }

  private async isCertificateTrusted(pem: string): Promise<boolean> {
    const fingerprint = await certificateFingerprint(pem);
    const trusted = await this.incus.$api.certificates.list();
    // A restricted entry cannot create cluster projects, so it does not count.
    return trusted.some((c) => c.fingerprint === fingerprint && !c.restricted);
  }

  /** Adds a certificate (default: the appliance's own) to the Incus trust store. Idempotent. */
  async trust(pem?: string): Promise<void> {
    const cert = pem ?? (await this.readFile(APPLIANCE_PATHS.clientCert));
    if (!cert)
      throw new Error("The appliance's client certificate was not found");
    if (await this.isCertificateTrusted(cert)) return;
    try {
      await this.incus.$api.certificates.create({
        type: "client",
        certificate: pemBody(cert),
        name: APPLIANCE_CERT_NAME,
        restricted: false,
        description: "Incendio Kubernetes management appliance (agent + CAPN)",
      });
    } catch (error) {
      if (error instanceof IncusError && error.isConflict) return;
      throw error;
    }
  }

  // ─── Status ─────────────────────────────────────────────────────────────

  /** Which bring-up stage the appliance is at (the UI's Management tab checklist). */
  async state(): Promise<ManagementState> {
    const container = await this.instance();
    if (!container) {
      return state(
        "not-deployed",
        "No management appliance",
        "Deploy a management appliance before creating clusters.",
      );
    }
    if (!container.isRunning) {
      return state(
        "stopped",
        "Management appliance stopped",
        `The appliance container is ${container.status.toLowerCase()}. Start it to manage clusters.`,
      );
    }

    let agent: AgentInfo | undefined;
    try {
      agent = await (await this.agent()).info();
    } catch {
      agent = undefined;
    }

    // A reachable agent is proof enough, whatever cloud-init says.
    if (agent) {
      if (!agent.capabilities.capn) {
        return state(
          "capn-pending",
          "Cluster API starting",
          "The agent is up but the CAPN controller is not available yet.",
          { agent },
        );
      }
      if ((await this.isTrusted()) === false) {
        return state(
          "incus-untrusted",
          "Appliance not trusted by Incus",
          "The agent's Incus client certificate is not in the trust store, so it cannot create cluster projects or instances. Call trust().",
          { agent },
        );
      }
      return state(
        "ready",
        "Management appliance ready",
        "Cluster API and the Incus provider (CAPN) are running.",
        { agent },
      );
    }

    const cloudInit = await this.cloudInit();
    if (cloudInit && !cloudInit.done) {
      return state(
        "bootstrapping",
        "Bootstrapping management appliance",
        "Installing k3s, Cluster API and the agent. This takes a few minutes.",
      );
    }
    if (cloudInit && cloudInit.errors.length > 0) {
      return state(
        "bootstrap-failed",
        "Bootstrap failed",
        `cloud-init reported: ${cloudInit.errors.join("; ")}`,
        {
          errors: cloudInit.errors,
        },
      );
    }
    return state(
      "agent-unreachable",
      "Agent unreachable",
      "The appliance finished bootstrapping but the agent does not answer (check the handle URL, the host proxy on :8843 and, in browsers, approve its self-signed certificate).",
    );
  }

  /**
   * Polls until clusters can be created, reporting each stage change.
   * Throws on a failed bootstrap, a stopped/missing appliance or a timeout.
   */
  async waitUntilReady(
    opts: WaitForApplianceOptions = {},
  ): Promise<K8sAgentClient> {
    const deadline = Date.now() + (opts.timeout ?? 1200) * 1000;
    const interval = (opts.interval ?? 5) * 1000;
    let last: ManagementStage | undefined;
    for (;;) {
      const current = await this.state();
      if (current.stage !== last) {
        last = current.stage;
        opts.onStage?.(current);
      }
      if (current.ready) return this.agent();
      if (current.stage === "incus-untrusted" && opts.autoTrust) {
        await this.trust();
        continue;
      }
      if (
        [
          "not-deployed",
          "stopped",
          "bootstrap-failed",
          "incus-untrusted",
        ].includes(current.stage)
      ) {
        const log =
          current.stage === "bootstrap-failed"
            ? `\n${await this.bootstrapLog(20)}`
            : "";
        throw new Error(`${current.title}: ${current.message}${log}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for the management appliance (stage: ${current.stage})`,
        );
      }
      await sleep(interval);
    }
  }

  // ─── Deploy ─────────────────────────────────────────────────────────────

  /**
   * Creates and starts the appliance, trusts its client certificate and
   * stores the agent handle. Bootstrapping then takes several minutes; follow
   * it with `waitUntilReady()`.
   */
  async deploy(opts: DeployApplianceOptions = {}): Promise<AgentHandle> {
    if (await this.instance()) {
      throw new Error(
        `The management appliance ${this.project}/${this.name} already exists; use waitUntilReady() or agent()`,
      );
    }
    const info = await this.incus.info();
    const serverCrt = info.environment.certificate;
    const address = firstAddress(info.environment.addresses);
    const location = (globalThis as { location?: Location }).location;
    const clientHost = (() => {
      try {
        const url = this.incus.$api.$r.defaults.baseURL ?? "";
        const host = new URL(url).hostname;
        return host && host !== "unix.socket" ? host : undefined;
      } catch {
        return undefined;
      }
    })();
    const agentHost =
      opts.agentHost ??
      location?.hostname ??
      clientHost ??
      address?.split(":")[0];
    if (!agentHost)
      throw new Error("Cannot determine the agent host; pass agentHost");
    const incusApiUrl =
      opts.incusApiUrl ??
      (address ? `https://${address}` : `https://${agentHost}:8443`);
    const corsOrigin =
      opts.corsOrigin ?? location?.origin ?? `https://${agentHost}:8443`;
    const credentials = opts.credentials ?? (await generateClientCredential());

    // The agent reaches Incus with this cert; trust it up front so it can
    // create cluster projects as soon as it is up.
    await this.trust(credentials.clientCrt);

    try {
      await this.incus.$api.projects.create({
        name: this.project,
        description: "Incendio-managed Kubernetes management project",
        config: {
          "features.images": "true",
          // Inherit the default project's profiles so the container gets a
          // root disk + NIC from them where they exist.
          "features.profiles": "false",
          [PROJECT_KEYS.managed]: "true",
          [PROJECT_KEYS.role]: "management",
        },
      });
    } catch (error) {
      if (
        !(error instanceof IncusError && error.isConflict) &&
        !/exist/i.test(String(error))
      ) {
        throw error;
      }
    }

    const scoped = this.scoped.$api;
    const [profile, pools, networks] = await Promise.all([
      scoped.profiles.get("default"),
      scoped.storagePools.list(),
      scoped.networks.list(),
    ]);
    const devices = resolveApplianceDevices(profile, pools, networks);

    const token = hexSecret();
    const repo = opts.bootstrapRepo ?? BOOTSTRAP_REPO;
    const tag = opts.bootstrapTag ?? DEFAULT_BOOTSTRAP_TAG;
    const cloudInit = buildApplianceCloudInit({
      token,
      jwtSecret: hexSecret(),
      corsOrigin,
      agentHost,
      incusApiUrl,
      credentials,
      serverCrt,
      repo,
      tag,
    });

    await this.scoped.createInstance({
      name: this.name,
      type: "container",
      description:
        "Incendio Kubernetes management appliance (single-node k3s + CAPN + agent)",
      source: APPLIANCE_IMAGE,
      config: {
        "security.nesting": "true",
        "security.privileged": "true",
        "limits.cpu": String(opts.cpu ?? 2),
        "limits.memory": opts.memory ?? "4GiB",
        "cloud-init.user-data": cloudInit,
        [PROJECT_KEYS.managed]: "true",
        [PROJECT_KEYS.role]: "management",
      },
      devices: {
        ...devices,
        // Publish the agent's HTTPS port on the host.
        "k8s-api": {
          type: "proxy",
          listen: `tcp:0.0.0.0:${AGENT_PORT}`,
          connect: `tcp:127.0.0.1:${AGENT_PORT}`,
          bind: "host",
        },
      },
      target: opts.target,
      start: true,
    });

    const handle: AgentHandle = {
      url: `https://${agentHost}:${AGENT_PORT}`,
      token,
      // Filled in by agent() once the bootstrap has generated the agent's cert.
      fingerprint: null,
    };
    await this.saveHandle(handle);
    return handle;
  }
}
