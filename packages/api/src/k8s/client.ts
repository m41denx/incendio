import type { IncusClient } from "../humane/Client";
import { K8sAgentClient } from "./agent";
import {
  ManagementAppliance,
  type AgentTransport,
  type DeployApplianceOptions,
  type WaitForApplianceOptions,
} from "./appliance";
import { K8sCluster, type WaitForClusterOptions } from "./cluster";
import { createClusterRequest, type ClusterSpec } from "./spec";
import type { AgentHandle, AgentInfo } from "./types";

export interface K8sClientOptions {
  /**
   * Agent to use instead of the handle stored in Incus (`user.k8s.api-config`).
   */
  agent?: AgentHandle;
  /**
   * Builds axios defaults that pin the agent's self-signed certificate —
   * `nodeK8sOptions.agentTransport` from `@incendio/api/node` in Node/Bun.
   * Browsers verify the certificate themselves (the user approves it once).
   */
  agentTransport?: AgentTransport;
  /** Management project / appliance name (defaults: `incendio-mgmt` / `k8s-manager`). */
  project?: string;
  applianceName?: string;
}

export interface CreateClusterOptions extends WaitForClusterOptions {
  /** Wait until the cluster is ready (default true). */
  wait?: boolean;
}

/**
 * Kubernetes on Incus through the Incendio agent: deploy the management
 * appliance, then create and manage clusters — what the UI's Kubernetes pages do.
 *
 * @example
 * import { createIncusClient } from "@incendio/api";
 * import { createK8sClient } from "@incendio/api/k8s";
 * import { nodeTransport, nodeK8sOptions } from "@incendio/api/node";
 *
 * const k8s = createK8sClient(createIncusClient(nodeTransport()), nodeK8sOptions);
 * await k8s.ensureManagement({ onStage: (s) => console.log(s.title) });
 * const cluster = await k8s.createCluster({
 *   name: "demo",
 *   workers: { count: 2, flavor: { cpu: 2, memoryGiB: 4 } },
 * });
 * console.log(await cluster.kubeconfig());
 */
export class K8sClient {
  readonly incus: IncusClient;
  readonly appliance: ManagementAppliance;
  private readonly options: K8sClientOptions;
  private agentPromise?: Promise<K8sAgentClient>;

  constructor(incus: IncusClient, options: K8sClientOptions = {}) {
    this.incus = incus;
    this.options = options;
    this.appliance = new ManagementAppliance(incus, {
      project: options.project,
      name: options.applianceName,
      agentTransport: options.agentTransport,
    });
  }

  /** The raw agent client (resolved once from the options or the stored handle). */
  agent(): Promise<K8sAgentClient> {
    this.agentPromise ??= (async () => {
      const handle = this.options.agent;
      if (!handle) return this.appliance.agent();
      return new K8sAgentClient({
        url: handle.url,
        token: handle.token,
        axios:
          this.options.agentTransport && handle.fingerprint
            ? this.options.agentTransport({ fingerprint: handle.fingerprint })
            : undefined,
      });
    })();
    this.agentPromise.catch(() => (this.agentPromise = undefined));
    return this.agentPromise;
  }

  /** Agent handshake: version and capabilities. */
  async info(): Promise<AgentInfo> {
    return (await this.agent()).info();
  }

  /**
   * Makes sure clusters can be created: deploys the management appliance if
   * there is none, then waits for it to be ready.
   */
  async ensureManagement(
    opts: DeployApplianceOptions & WaitForApplianceOptions = {},
  ): Promise<void> {
    if (!(await this.appliance.instance())) {
      await this.appliance.deploy(opts);
      this.agentPromise = undefined;
    }
    await this.appliance.waitUntilReady(opts);
  }

  async listClusters(): Promise<K8sCluster[]> {
    const agent = await this.agent();
    const records = await agent.listClusters();
    return records.map((r) => new K8sCluster(agent, this.incus, r));
  }

  /** A cluster with its live status loaded. */
  async getCluster(name: string): Promise<K8sCluster> {
    const agent = await this.agent();
    const cluster = new K8sCluster(
      agent,
      this.incus,
      await agent.getCluster(name),
    );
    await cluster.getStatus();
    return cluster;
  }

  /**
   * Creates a cluster from a spec (see `ClusterSpec` for the defaults: 1
   * control-plane + 1 worker `c2-m4` containers, flannel, LXC load balancer)
   * and, unless `wait: false`, waits until it is ready.
   */
  async createCluster(
    spec: ClusterSpec,
    opts: CreateClusterOptions = {},
  ): Promise<K8sCluster> {
    const agent = await this.agent();
    const record = await agent.createCluster(createClusterRequest(spec));
    const cluster = new K8sCluster(agent, this.incus, record);
    if (opts.wait !== false) await cluster.waitUntilReady(opts);
    return cluster;
  }

  /** Deletes a cluster by name. */
  async deleteCluster(name: string): Promise<void> {
    await (await this.agent()).deleteCluster(name);
  }
}

/** Creates a Kubernetes client on top of a humane Incus client. */
export const createK8sClient = (
  incus: IncusClient,
  options?: K8sClientOptions,
): K8sClient => new K8sClient(incus, options);
