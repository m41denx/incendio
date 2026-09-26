import { IncusError } from "../api/base/types";
import type { Instance as InstanceT } from "../api/types/generated";
import type { IncusClient } from "../humane/Client";
import { K8sAgentError, type K8sAgentClient } from "./agent";
import { upgradeTargets } from "./spec";
import type {
  ActivityEntry,
  ClusterRecord,
  ClusterStatus,
  ClusterStatusView,
  Machine,
  MetalLBStatus,
} from "./types";

/** An Incus instance of the cluster joined with its CAPI machine. */
export interface ClusterNode {
  name: string;
  role: "control-plane" | "worker" | "loadbalancer";
  instance?: InstanceT;
  machine?: Machine;
}

export type BootstrapState = "running" | "succeeded" | "failed" | "unknown";

export interface BootstrapDiagnosis {
  state: BootstrapState;
  /** The line explaining the failure, e.g. kubeadm's `[ERROR NumCPU]`. */
  reason?: string;
  /** Last lines of the node's cloud-init output. */
  logTail?: string;
}

export interface WaitForClusterOptions {
  /** Seconds (default 1800). */
  timeout?: number;
  /** Poll interval in seconds (default 10). */
  interval?: number;
  /** Called on every poll with the live status. */
  onProgress?: (status: ClusterStatusView) => void;
  /**
   * Inspect nodes that never join and fail fast with kubeadm's error instead
   * of waiting for the timeout (default true).
   */
  diagnose?: boolean;
}

/** A node failed to bootstrap (kubeadm ran and failed inside cloud-init). */
export class K8sBootstrapError extends Error {
  readonly node: string;
  readonly diagnosis: BootstrapDiagnosis;

  constructor(node: string, diagnosis: BootstrapDiagnosis) {
    super(`Node ${node} failed to bootstrap: ${diagnosis.reason}`);
    this.name = "K8sBootstrapError";
    this.node = node;
    this.diagnosis = diagnosis;
  }
}

const NODE_PATHS = {
  cloudInitResult: "/var/lib/cloud/data/result.json",
  bootstrapSentinel: "/run/cluster-api/bootstrap-success.complete",
  cloudInitLog: "/var/log/cloud-init-output.log",
} as const;

// CAPN stamps every instance it launches with these.
const CLUSTER_KEY = "user.cluster-name";
const ROLE_KEY = "user.cluster-role";
const MACHINE_KEY = "user.machine-name";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The most telling error line in a cloud-init/kubeadm log. */
export const extractBootstrapError = (log: string): string | null => {
  const lines = log.split("\n").map((line) => line.trim());
  const kubeadm = lines.filter((line) => /^\[ERROR [^\]]+\]/.test(line));
  if (kubeadm.length > 0) return kubeadm.join("; ");
  return [...lines].reverse().find((line) => /^error\b/i.test(line)) ?? null;
};

/** Joins a cluster's Incus instances with its CAPI machines. */
export const groupClusterNodes = (
  cluster: string,
  instances: InstanceT[],
  machines: Machine[],
): ClusterNode[] => {
  const byName = new Map(machines.map((m) => [m.name, m]));
  const matched = new Set<string>();
  const nodes: ClusterNode[] = [];
  for (const instance of instances) {
    // An instance being deleted can be listed with `config: null`.
    const config = (instance.config ?? {}) as Record<
      string,
      string | undefined
    >;
    if (config[CLUSTER_KEY] !== cluster) continue;
    const machine = byName.get(config[MACHINE_KEY] ?? instance.name);
    if (machine) matched.add(machine.name);
    const role =
      config[ROLE_KEY] === "loadbalancer"
        ? "loadbalancer"
        : (machine?.role ??
          (config[ROLE_KEY] === "control-plane" ? "control-plane" : "worker"));
    nodes.push({ name: instance.name, role, instance, machine });
  }
  // Machines whose instance is not there (yet).
  for (const machine of machines) {
    if (!matched.has(machine.name)) {
      nodes.push({ name: machine.name, role: machine.role, machine });
    }
  }
  return nodes.sort(
    (a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name),
  );
};

/**
 * Instance of a Humane Incendio Kubernetes cluster.
 *
 * @example
 * const cluster = await k8s.createCluster({ name: "demo", workers: { count: 2 } });
 * await cluster.waitUntilReady({ onProgress: (s) => console.log(s.status, s.phase) });
 * writeFileSync("demo.kubeconfig", await cluster.kubeconfig());
 */
export class K8sCluster {
  private readonly agent: K8sAgentClient;
  private readonly incus: IncusClient;
  private $data: ClusterRecord;
  private $status?: ClusterStatusView;

  constructor(agent: K8sAgentClient, incus: IncusClient, data: ClusterRecord) {
    this.agent = agent;
    this.incus = incus;
    this.$data = data;
  }

  get data(): ClusterRecord {
    return this.$data;
  }
  get name() {
    return this.$data.name;
  }
  /** Incus project holding the cluster's instances. */
  get project() {
    return this.$data.project;
  }
  get kubernetesVersion() {
    return this.$status?.version ?? this.$data.kubernetesVersion;
  }
  get controlPlaneCount() {
    return this.$status?.controlPlane.desired ?? this.$data.controlPlaneCount;
  }
  get workerCount() {
    return this.$status?.workers.desired ?? this.$data.workerCount;
  }
  get status(): ClusterStatus {
    return this.$status?.status ?? this.$data.status;
  }
  get isReady() {
    return this.status === "ready";
  }
  get phase() {
    return this.$status?.phase ?? this.$data.phase;
  }
  /** Why the cluster is not Available yet. */
  get message() {
    return this.$status?.message ?? this.$data.message;
  }
  /** Workload API server, `https://host:port`. */
  get endpoint() {
    return this.$status?.endpoint ?? this.$data.endpoint;
  }
  /** CAPI machines, from the last `getStatus()`. */
  get machines(): Machine[] {
    return this.$status?.machines ?? [];
  }
  get createdAt() {
    return new Date(this.$data.createdAt);
  }
  /** Versions this cluster can be upgraded to next, newest first. */
  get upgradeTargets(): string[] {
    return upgradeTargets(this.kubernetesVersion);
  }

  /** Reloads the record (with live status overlay) from the agent. */
  async refresh(): Promise<this> {
    const all = await this.agent.listClusters();
    const record = all.find((c) => c.name === this.name);
    if (!record) {
      throw new K8sAgentError("cluster not found", 404, this.name);
    }
    this.$data = record;
    return this;
  }

  /** Live status, including machines. */
  async getStatus(): Promise<ClusterStatusView> {
    this.$status = await this.agent.getStatus(this.name);
    return this.$status;
  }

  /**
   * Polls until the cluster is ready. Throws on `error` status, on a problem
   * the agent reports (e.g. an unusable API endpoint), on a node
   * whose kubeadm bootstrap failed (see `diagnose`), or on timeout.
   */
  async waitUntilReady(
    opts: WaitForClusterOptions = {},
  ): Promise<ClusterStatusView> {
    const deadline = Date.now() + (opts.timeout ?? 1800) * 1000;
    const interval = (opts.interval ?? 10) * 1000;
    const diagnosed = new Set<string>();
    for (;;) {
      const status = await this.getStatus();
      opts.onProgress?.(status);
      if (status.status === "ready") return status;
      if (status.problem) {
        throw new Error(
          `Cluster ${this.name} will not come up: ${status.problem}`,
        );
      }
      if (status.status === "error") {
        throw new Error(
          `Cluster ${this.name} is in error: ${status.message ?? "see activity()"}`,
        );
      }
      if (opts.diagnose !== false) {
        for (const node of await this.nodes()) {
          if (diagnosed.has(node.name) || !this.worthDiagnosing(node)) continue;
          const diagnosis = await this.diagnoseNode(node.name);
          if (diagnosis.state === "failed")
            throw new K8sBootstrapError(node.name, diagnosis);
          if (diagnosis.state === "succeeded") diagnosed.add(node.name);
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for cluster ${this.name} (status: ${status.status}${status.message ? `, ${status.message}` : ""})`,
        );
      }
      await sleep(interval);
    }
  }

  // Only nodes whose machine never joined: the success sentinel lives on
  // /run, so a joined node that rebooted would look "failed" too.
  private worthDiagnosing(node: ClusterNode): boolean {
    return (
      node.instance?.status === "Running" &&
      node.machine !== undefined &&
      !node.machine.nodeName
    );
  }

  /** Why the cluster cannot come up on its own, when the agent can tell. */
  get problem(): string | undefined {
    return this.$status?.problem ?? this.$data.problem;
  }

  /** MetalLB state, address pool and LoadBalancer services. */
  metallb(): Promise<MetalLBStatus> {
    return this.agent.getMetalLB(this.name);
  }

  /**
   * Installs MetalLB, or changes its pool. Without addresses, uses the free
   * range the agent suggests for the cluster's network.
   */
  async setMetalLB(addresses?: string[]): Promise<void> {
    let pool = addresses;
    if (!pool?.length) {
      const hint = await this.agent.getMetalLBHint(this.name);
      if (!hint.range) {
        throw new Error(
          `No free address range on ${hint.network}${hint.warning ? `: ${hint.warning}` : ""}`,
        );
      }
      pool = [hint.range];
    }
    await this.agent.setMetalLB(this.name, pool);
  }

  /** Removes MetalLB; LoadBalancer services go back to pending. */
  async removeMetalLB(): Promise<void> {
    await this.agent.removeMetalLB(this.name);
  }

  /** Admin kubeconfig. Throws a 409 `K8sAgentError` until the control plane is up. */
  kubeconfig(): Promise<string> {
    return this.agent.getKubeconfig(this.name);
  }

  /** Events and controller log lines, oldest first. */
  activity(limit = 200): Promise<ActivityEntry[]> {
    return this.agent.getActivity(this.name, limit);
  }

  /** Changes the number of control-plane (odd) and/or worker nodes. */
  async scale(counts: {
    controlPlane?: number;
    workers?: number;
  }): Promise<void> {
    this.$data = await this.agent.updateCluster(this.name, {
      controlPlaneCount: counts.controlPlane,
      workerCount: counts.workers,
    });
    this.$status = undefined;
  }

  /**
   * Upgrades Kubernetes one step (default: the newest allowed target).
   * CAPI replaces control-plane nodes first, then workers.
   */
  async upgrade(version?: string): Promise<void> {
    const target = version ?? this.upgradeTargets[0];
    if (!target) {
      throw new Error(
        `No newer Kubernetes version available for ${this.kubernetesVersion}`,
      );
    }
    this.$data = await this.agent.updateCluster(this.name, {
      kubernetesVersion: target,
    });
    this.$status = undefined;
  }

  /** Deletes the cluster: its machines, load balancer and Incus project. */
  async delete(): Promise<void> {
    await this.agent.deleteCluster(this.name);
  }

  /** Incus instances of the cluster joined with their CAPI machines. */
  async nodes(): Promise<ClusterNode[]> {
    if (!this.$status) await this.getStatus();
    const instances = this.project
      ? await this.incus.useProject(this.project).$api.instances.list()
      : [];
    return groupClusterNodes(this.name, instances, this.machines);
  }

  private async readNodeFile(
    node: string,
    path: string,
  ): Promise<string | null> {
    if (!this.project) return null;
    try {
      return await this.incus
        .useProject(this.project)
        .$api.instance(node)
        .files.readText(path);
    } catch (error) {
      if (error instanceof IncusError && error.isNotFound) return null;
      throw error;
    }
  }

  /** The node's cloud-init output log (kubeadm join/init output). */
  async nodeLog(node: string, lines = 200): Promise<string> {
    const log = (await this.readNodeFile(node, NODE_PATHS.cloudInitLog)) ?? "";
    return log.trimEnd().split("\n").slice(-lines).join("\n");
  }

  /**
   * Why a node never joined. CAPI writes a success sentinel only if kubeadm
   * succeeded, while cloud-init reports done either way.
   */
  async diagnoseNode(node: string): Promise<BootstrapDiagnosis> {
    const [result, sentinel] = await Promise.all([
      this.readNodeFile(node, NODE_PATHS.cloudInitResult).catch(
        () => undefined,
      ),
      this.readNodeFile(node, NODE_PATHS.bootstrapSentinel).catch(
        () => undefined,
      ),
    ]);
    if (sentinel !== null && sentinel !== undefined)
      return { state: "succeeded" };
    if (result === null) return { state: "running" };
    if (result !== undefined && sentinel === null) {
      const log = await this.nodeLog(node, 30).catch(() => "");
      return {
        state: "failed",
        reason:
          (log ? extractBootstrapError(log) : null) ??
          "kubeadm did not complete (no Cluster API bootstrap success marker)",
        logTail: log || undefined,
      };
    }
    return { state: "unknown" };
  }
}
