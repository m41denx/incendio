import axios, {
  type AxiosInstance,
  type CreateAxiosDefaults,
  type Method,
} from "axios";
import type {
  ActivityEntry,
  AgentInfo,
  ClusterPatchRequest,
  ClusterRecord,
  ClusterStatusView,
  ControllerHealth,
  ControllerRestart,
  CreateClusterRequest,
  MetalLBHint,
  MetalLBState,
  MetalLBStatus,
} from "./types";

/** An error answered by the Kubernetes agent (or a transport failure). */
export class K8sAgentError extends Error {
  /** HTTP status, or 0 when the agent could not be reached. */
  readonly status: number;
  /** The agent's `detail` (Incus/TLS/CAPN cause), when given. */
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(detail ? `${message}: ${detail}` : message);
    this.name = "K8sAgentError";
    this.status = status;
    this.detail = detail;
  }

  get isNotFound() {
    return this.status === 404;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  /** The management cluster (CAPN) is not ready yet (503). */
  get isNotReady() {
    return this.status === 503;
  }
}

export interface K8sAgentOptions {
  /** Agent base URL, e.g. `https://incus-host:8843`. */
  url: string;
  /** Bearer token (`AGENT_TOKEN` of the appliance). */
  token: string;
  /** Extra axios defaults — in Node, `pinnedAxios(fingerprint)` from `@incendio/api/node`. */
  axios?: CreateAxiosDefaults;
  timeout?: number;
}

const toAgentError = (error: unknown): K8sAgentError => {
  if (!axios.isAxiosError(error)) {
    return new K8sAgentError(String(error), 0);
  }
  const response = error.response;
  if (!response) {
    return new K8sAgentError(
      `Kubernetes agent unreachable (${error.message})`,
      0,
    );
  }
  const body = response.data as Record<string, unknown> | string | undefined;
  if (response.status === 401) {
    return new K8sAgentError(
      "The agent rejected the token (AGENT_TOKEN in /etc/incendio/agent.env inside the appliance)",
      401,
    );
  }
  if (body && typeof body === "object") {
    // Handlers answer { error, detail }; Elysia validation answers { message }.
    const message =
      (typeof body.error === "string" && body.error) ||
      (typeof body.message === "string" && body.message) ||
      `agent responded ${response.status}`;
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    return new K8sAgentError(message, response.status, detail);
  }
  return new K8sAgentError(
    typeof body === "string" && body
      ? body
      : `agent responded ${response.status}`,
    response.status,
  );
};

const seg = encodeURIComponent;

/**
 * Stateless client for the Incendio Kubernetes agent (`/v1`), the broker over
 * Cluster API + CAPN running in the management appliance.
 */
export class K8sAgentClient {
  readonly url: string;
  private readonly r: AxiosInstance;

  constructor(options: K8sAgentOptions) {
    this.url = options.url.trim().replace(/\/+$/, "");
    this.r = axios.create({
      baseURL: this.url,
      timeout: options.timeout ?? 60_000,
      ...options.axios,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.token}`,
        ...(options.axios?.headers as Record<string, string> | undefined),
      },
    });
  }

  /** The underlying axios instance. */
  get $r(): AxiosInstance {
    return this.r;
  }

  private async call<T>(
    method: Method,
    path: string,
    opts: { data?: unknown; params?: Record<string, unknown> } = {},
  ): Promise<T> {
    try {
      const { data } = await this.r.request<T>({ method, url: path, ...opts });
      return data;
    } catch (error) {
      throw toAgentError(error);
    }
  }

  /** Liveness probe. */
  async health(): Promise<boolean> {
    const { status } = await this.call<{ status: string }>("GET", "/health");
    return status === "ok";
  }

  /** Handshake: version, capabilities (`capn` = ready to create clusters). */
  info(): Promise<AgentInfo> {
    return this.call<AgentInfo>("GET", "/v1/info");
  }

  /** Clusters with live CRD status overlaid on the agent's cache. */
  async listClusters(): Promise<ClusterRecord[]> {
    const { clusters } = await this.call<{ clusters: ClusterRecord[] }>(
      "GET",
      "/v1/clusters",
    );
    return clusters;
  }

  /** The cached record (no live overlay; see `getStatus`). */
  getCluster(name: string): Promise<ClusterRecord> {
    return this.call<ClusterRecord>("GET", `/v1/clusters/${seg(name)}`);
  }

  /** Live status with machines (falls back to the cache when CAPN is down). */
  getStatus(name: string): Promise<ClusterStatusView> {
    return this.call<ClusterStatusView>(
      "GET",
      `/v1/clusters/${seg(name)}/status`,
    );
  }

  /** Creates a cluster; returns right after the CAPN manifest is applied. */
  createCluster(body: CreateClusterRequest): Promise<ClusterRecord> {
    return this.call<ClusterRecord>("POST", "/v1/clusters", { data: body });
  }

  /** Scales and/or upgrades a cluster. */
  updateCluster(
    name: string,
    body: ClusterPatchRequest,
  ): Promise<ClusterRecord> {
    return this.call<ClusterRecord>("PATCH", `/v1/clusters/${seg(name)}`, {
      data: body,
    });
  }

  /** Deletes a cluster (CAPN teardown, then its Incus project). */
  deleteCluster(
    name: string,
  ): Promise<{ deleted: string; project: string | null }> {
    return this.call("DELETE", `/v1/clusters/${seg(name)}`);
  }

  /** Admin kubeconfig. Throws a 409 `K8sAgentError` until the control plane is up. */
  async getKubeconfig(name: string): Promise<string> {
    const { kubeconfig } = await this.call<{ kubeconfig: string }>(
      "GET",
      `/v1/clusters/${seg(name)}/kubeconfig`,
    );
    return kubeconfig;
  }

  /** Events and controller log lines about the cluster, oldest first. */
  async getActivity(name: string, limit = 200): Promise<ActivityEntry[]> {
    const { entries } = await this.call<{ entries: ActivityEntry[] }>(
      "GET",
      `/v1/clusters/${seg(name)}/activity`,
      { params: { limit } },
    );
    return entries;
  }

  /** MetalLB state, address pool and LoadBalancer services of a cluster. */
  getMetalLB(name: string): Promise<MetalLBStatus> {
    return this.call<MetalLBStatus>("GET", `/v1/clusters/${seg(name)}/metallb`);
  }

  /**
   * Installs MetalLB with these addresses (ranges, CIDRs or single IPv4s on
   * the nodes' network), or changes the pool of an installed one. Runs in the
   * background; poll `getMetalLB`. 409 when they overlap another cluster's
   * pool or API endpoint, or the control plane is not up yet.
   */
  setMetalLB(
    name: string,
    addresses: string[],
  ): Promise<{ state: MetalLBState; requested: string[] }> {
    return this.call("PUT", `/v1/clusters/${seg(name)}/metallb`, {
      data: { addresses },
    });
  }

  /** Removes MetalLB (in the background); services go back to pending. */
  removeMetalLB(name: string): Promise<{ state: MetalLBState }> {
    return this.call("DELETE", `/v1/clusters/${seg(name)}/metallb`);
  }

  /**
   * The network a cluster's nodes use and a free address block on it for
   * MetalLB. Without `cluster`: the network a new cluster would get.
   */
  getMetalLBHint(cluster?: string): Promise<MetalLBHint> {
    return this.call<MetalLBHint>("GET", "/v1/clusters/metallb-hint", {
      params: cluster ? { cluster } : undefined,
    });
  }

  /** Cluster API controllers, nodes they cannot inspect, the last restart. */
  getControllers(): Promise<ControllerHealth> {
    return this.call<ControllerHealth>("GET", "/v1/management/controllers");
  }

  /**
   * Restarts the Cluster API controllers in the background (for when they
   * are stuck after the appliance was paused). 409 while one is running.
   */
  restartControllers(): Promise<ControllerRestart> {
    return this.call<ControllerRestart>(
      "POST",
      "/v1/management/controllers/restart",
    );
  }
}
