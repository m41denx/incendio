import { readFileSync } from "node:fs";
import { env } from "../env.ts";
import { log } from "./log.ts";
import { execError, run } from "./exec.ts";

/**
 * CAPI/CAPN broker. The agent never reconciles (docs/k8s/deploy-model.md §4);
 * it shells out to `clusterctl`/`kubectl` against the local mgmt k3s cluster,
 * exactly as an operator would, and treats the CAPI/CAPN CRDs as the single
 * source of truth. Everything here is validated against a live appliance:
 * cluster-template.yaml wires `loadBalancer` from LOAD_BALANCER and the
 * LXCCluster identity from an in-namespace secret named by LXC_SECRET_NAME.
 */

// Workload Cluster/Machine/secret objects all live in this namespace on the
// mgmt cluster. `default` matches `clusterctl generate --target-namespace`.
export const WORKLOAD_NAMESPACE = "default";
// CAPN controller install landmarks (created by bootstrap.sh `clusterctl init`).
const CAPN_NAMESPACE = "capn-system";
const CAPN_DEPLOYMENT = "capn-controller-manager";

function kubeEnv(): Record<string, string> {
  return { KUBECONFIG: env.KUBECONFIG };
}

/** Per-cluster identity secret name (same in create and delete). */
export function secretNameFor(cluster: string): string {
  return `incendio-${cluster}`;
}

/**
 * True when the CAPN infrastructure provider is installed and its controller
 * has at least one available replica — i.e. the agent can actually create
 * clusters. Backs the `capn` capability in /v1/info.
 */
export async function capnReady(): Promise<boolean> {
  const r = await run(
    [
      "kubectl",
      "get",
      "deployment",
      CAPN_DEPLOYMENT,
      "-n",
      CAPN_NAMESPACE,
      "-o",
      "jsonpath={.status.availableReplicas}",
    ],
    { env: kubeEnv(), timeoutMs: 10_000 },
  );
  if (!r.ok) return false;
  return Number.parseInt(r.stdout.trim() || "0", 10) >= 1;
}

/** Map a UI load-balancer type to the YAML fragment the template substitutes. */
function loadBalancerFragment(type: string): string {
  switch (type) {
    case "lxc":
    case "oci":
      // Zero-config haproxy instance; the only requirement is that the mgmt
      // cluster can reach the instance IP (docs load-balancer.md).
      return `${type}: {profiles: [default], flavor: c1-m1}`;
    default:
      throw new Error(
        `unsupported load balancer type '${type}' (agent auto-provisioning supports lxc, oci)`,
      );
  }
}

export interface GenerateInput {
  name: string;
  kubernetesVersion: string;
  controlPlaneCount: number;
  workerCount: number;
  secretName: string;
  loadBalancer: string;
}

/**
 * Render the workload cluster manifest with the default CAPN template. The
 * template needs two variables: LOAD_BALANCER (how to provision the control
 * plane endpoint) and LXC_SECRET_NAME (the Incus identity secret). CLUSTERCTL
 * config carries the `incus` provider registration written by bootstrap.sh.
 */
export async function generateCluster(input: GenerateInput): Promise<string> {
  const r = await run(
    [
      "clusterctl",
      "generate",
      "cluster",
      input.name,
      "--kubernetes-version",
      input.kubernetesVersion,
      "--control-plane-machine-count",
      String(input.controlPlaneCount),
      "--worker-machine-count",
      String(input.workerCount),
      "--infrastructure",
      `incus:${env.CAPN_VERSION}`,
      "--target-namespace",
      WORKLOAD_NAMESPACE,
      "--config",
      env.CLUSTERCTL_CONFIG,
    ],
    {
      env: {
        ...kubeEnv(),
        LOAD_BALANCER: loadBalancerFragment(input.loadBalancer),
        LXC_SECRET_NAME: input.secretName,
      },
      timeoutMs: 30_000,
    },
  );
  if (!r.ok) throw new Error(`clusterctl generate failed: ${execError(r)}`);
  return r.stdout;
}

/** `kubectl apply -f -` a manifest (YAML or JSON) piped over stdin. */
export async function kubectlApply(manifest: string): Promise<void> {
  const r = await run(["kubectl", "apply", "-f", "-"], {
    input: manifest,
    env: kubeEnv(),
    timeoutMs: 30_000,
  });
  if (!r.ok) throw new Error(`kubectl apply failed: ${execError(r)}`);
}

/**
 * Create/update the CAPN identity secret for a cluster. The keys are exactly
 * what the LXCCluster controller reads (see CAPN identity-secret reference):
 * server URL, client cert/key, optional server cert, project, and the
 * insecure-skip-verify toggle. We reuse the agent's own Incus credentials.
 */
export async function applyIdentitySecret(
  name: string,
  project: string,
): Promise<void> {
  if (!env.INCUS_CLIENT_CERT || !env.INCUS_CLIENT_KEY) {
    throw new Error(
      "cannot build CAPN identity secret: INCUS_CLIENT_CERT/INCUS_CLIENT_KEY are not set",
    );
  }
  const stringData: Record<string, string> = {
    server: env.INCUS_API_URL,
    "client-crt": readFileSync(env.INCUS_CLIENT_CERT, "utf8"),
    "client-key": readFileSync(env.INCUS_CLIENT_KEY, "utf8"),
    project,
    "insecure-skip-verify": env.INCUS_INSECURE_SKIP_VERIFY ? "true" : "false",
  };
  if (env.INCUS_SERVER_CERT) {
    stringData["server-crt"] = readFileSync(env.INCUS_SERVER_CERT, "utf8");
  }
  const manifest = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name,
      namespace: WORKLOAD_NAMESPACE,
      // `clusterctl move` should carry the secret with the cluster.
      labels: { "clusterctl.cluster.x-k8s.io/move": "true" },
    },
    stringData,
  };
  await kubectlApply(JSON.stringify(manifest));
}

export interface LiveStatus {
  phase: string;
  available: boolean;
  controlPlaneReady: number;
  workerReady: number;
  conditions: unknown[];
}

interface K8sList {
  items?: {
    metadata?: { name?: string; labels?: Record<string, string> };
    status?: {
      phase?: string;
      conditions?: { type?: string; status?: string }[];
    };
  }[];
}

/**
 * Live status for every workload cluster in one pass: one `kubectl get
 * clusters` plus one `kubectl get machines`, keyed by cluster name. Ready
 * machine counts are split into control-plane vs worker by the standard CAPI
 * label. Desired counts stay in the cache; the CRDs own actual state.
 */
export async function getLiveStatuses(): Promise<Map<string, LiveStatus>> {
  const [clustersRes, machinesRes] = await Promise.all([
    run(
      ["kubectl", "get", "clusters", "-n", WORKLOAD_NAMESPACE, "-o", "json"],
      { env: kubeEnv(), timeoutMs: 15_000 },
    ),
    run(
      ["kubectl", "get", "machines", "-n", WORKLOAD_NAMESPACE, "-o", "json"],
      { env: kubeEnv(), timeoutMs: 15_000 },
    ),
  ]);
  if (!clustersRes.ok) {
    throw new Error(`kubectl get clusters failed: ${execError(clustersRes)}`);
  }
  if (!machinesRes.ok) {
    throw new Error(`kubectl get machines failed: ${execError(machinesRes)}`);
  }

  const machines = (JSON.parse(machinesRes.stdout) as K8sList).items ?? [];
  const cpReady = new Map<string, number>();
  const workerReady = new Map<string, number>();
  for (const m of machines) {
    const labels = m.metadata?.labels ?? {};
    const cluster = labels["cluster.x-k8s.io/cluster-name"];
    if (!cluster) continue;
    if (m.status?.phase !== "Running") continue;
    const isControlPlane =
      "cluster.x-k8s.io/control-plane" in labels;
    const bucket = isControlPlane ? cpReady : workerReady;
    bucket.set(cluster, (bucket.get(cluster) ?? 0) + 1);
  }

  const clusters = (JSON.parse(clustersRes.stdout) as K8sList).items ?? [];
  const out = new Map<string, LiveStatus>();
  for (const c of clusters) {
    const name = c.metadata?.name;
    if (!name) continue;
    const conditions = c.status?.conditions ?? [];
    const available = conditions.some(
      (cond) => cond.type === "Available" && cond.status === "True",
    );
    out.set(name, {
      phase: c.status?.phase ?? "Unknown",
      available,
      controlPlaneReady: cpReady.get(name) ?? 0,
      workerReady: workerReady.get(name) ?? 0,
      conditions,
    });
  }
  return out;
}

/**
 * Tear down a workload cluster's CAPI objects: delete the Cluster (CAPN
 * cascades LB + machines + the underlying Incus instances) and remove the
 * per-cluster addons and identity secret. Waits for the Cluster to be gone so
 * the caller can then delete the now-empty Incus project.
 */
export async function deleteClusterCrd(name: string): Promise<void> {
  const del = await run(
    [
      "kubectl",
      "delete",
      "cluster",
      name,
      "-n",
      WORKLOAD_NAMESPACE,
      "--ignore-not-found",
      "--wait=true",
      "--timeout=110s",
    ],
    { env: kubeEnv(), timeoutMs: 120_000 },
  );
  if (!del.ok) throw new Error(`kubectl delete cluster failed: ${execError(del)}`);

  // Per-cluster flannel addon + identity secret are named after the cluster and
  // are not owned by the Cluster object, so remove them explicitly.
  const cleanup = await run(
    [
      "kubectl",
      "delete",
      "clusterresourceset,configmap,secret",
      "-n",
      WORKLOAD_NAMESPACE,
      `${name}-kube-flannel`,
      secretNameFor(name),
      "--ignore-not-found",
    ],
    { env: kubeEnv(), timeoutMs: 20_000 },
  );
  if (!cleanup.ok) {
    log.warn(`cluster ${name}: addon/secret cleanup reported: ${execError(cleanup)}`);
  }
}
