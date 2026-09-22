import { readFileSync } from "node:fs";
import { env } from "../env.ts";
import { templateEnv } from "./template-vars.ts";
import { kubeconfigFromSecret } from "./kubeconfig.ts";
import { buildScalePatch, type ClusterObject, type ScaleRequest } from "./scale.ts";
import { summarizeLive, type K8sList, type LiveStatus } from "./capi-status.ts";
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
  /** Default load balancer type when the request does not set LOAD_BALANCER. */
  loadBalancer: string;
  /** CAPN template variables from the create request (validated). */
  variables: Record<string, string>;
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
        ...templateEnv(input.variables, {
          secretName: input.secretName,
          defaultLoadBalancer: loadBalancerFragment(input.loadBalancer),
        }),
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

export type { LiveStatus, MachineStatus } from "./capi-status.ts";

/**
 * Live status for every workload cluster in one pass: one `kubectl get
 * clusters` plus one `kubectl get machines`, keyed by cluster name. Ready
 * machine counts come from each Machine's Ready condition (see summarizeLive).
 * Desired counts stay in the cache; the CRDs own actual state.
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

  return summarizeLive(
    JSON.parse(clustersRes.stdout) as K8sList,
    JSON.parse(machinesRes.stdout) as K8sList,
  );
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

/**
 * The workload cluster's admin kubeconfig, or null while CAPI has not written
 * it yet (control plane still initializing).
 */
export async function getKubeconfig(name: string): Promise<string | null> {
  const r = await run(
    [
      "kubectl",
      "get",
      "secret",
      `${name}-kubeconfig`,
      "-n",
      WORKLOAD_NAMESPACE,
      "--ignore-not-found",
      "-o",
      "json",
    ],
    { env: kubeEnv(), timeoutMs: 15_000 },
  );
  if (!r.ok) throw new Error(`kubectl get kubeconfig secret failed: ${execError(r)}`);
  if (r.stdout.trim().length === 0) return null;
  return kubeconfigFromSecret(JSON.parse(r.stdout) as { data?: Record<string, string> });
}

/**
 * Scale a workload cluster by patching replicas in its Cluster topology; CAPI
 * rolls the change out (CAPN adds/removes Incus instances, kubeadm joins or
 * drains nodes). Returns once the patch is accepted, not when nodes are ready.
 */
export async function scaleCluster(name: string, request: ScaleRequest): Promise<void> {
  const get = await run(
    ["kubectl", "get", "cluster", name, "-n", WORKLOAD_NAMESPACE, "-o", "json"],
    { env: kubeEnv(), timeoutMs: 15_000 },
  );
  if (!get.ok) throw new Error(`kubectl get cluster failed: ${execError(get)}`);
  const patch = buildScalePatch(JSON.parse(get.stdout) as ClusterObject, request);
  const r = await run(
    [
      "kubectl",
      "patch",
      "cluster",
      name,
      "-n",
      WORKLOAD_NAMESPACE,
      "--type=json",
      "-p",
      JSON.stringify(patch),
    ],
    { env: kubeEnv(), timeoutMs: 20_000 },
  );
  if (!r.ok) throw new Error(`kubectl patch cluster failed: ${execError(r)}`);
}
