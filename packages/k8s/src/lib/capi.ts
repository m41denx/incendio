import { readFileSync } from "node:fs";
import { env } from "../env.ts";
import { templateEnv } from "./template-vars.ts";
import { kubeconfigFromSecret } from "./kubeconfig.ts";
import type { ClusterObject } from "./scale.ts";
import { buildClusterPatch, type ClusterPatchRequest } from "./cluster-patch.ts";
import { summarizeLive, type K8sList, type LiveStatus } from "./capi-status.ts";
import {
  eventActivity,
  logActivity,
  mergeActivity,
  type ActivityEntry,
  type K8sEventList,
} from "./activity.ts";
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
 * Apply a day-2 edit (replicas and/or Kubernetes version) to a workload
 * cluster's topology; CAPI rolls it out (CAPN adds, replaces or removes Incus
 * instances, kubeadm joins or drains nodes). Returns once the patch is
 * accepted, not when the rollout finishes. Throws PatchRejected when the
 * cluster's current state rules the request out.
 */
export async function patchCluster(
  name: string,
  request: ClusterPatchRequest,
): Promise<void> {
  const get = await run(
    ["kubectl", "get", "cluster", name, "-n", WORKLOAD_NAMESPACE, "-o", "json"],
    { env: kubeEnv(), timeoutMs: 15_000 },
  );
  if (!get.ok) throw new Error(`kubectl get cluster failed: ${execError(get)}`);
  const patch = buildClusterPatch(JSON.parse(get.stdout) as ClusterObject, request);
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

// Provider controllers whose logs narrate a cluster's bring-up, by label.
const CONTROLLERS: { source: string; namespace: string; deployment: string }[] = [
  { source: "capn", namespace: "capn-system", deployment: "capn-controller-manager" },
  { source: "capi", namespace: "capi-system", deployment: "capi-controller-manager" },
  {
    source: "control-plane",
    namespace: "capi-kubeadm-control-plane-system",
    deployment: "capi-kubeadm-control-plane-controller-manager",
  },
  {
    source: "bootstrap",
    namespace: "capi-kubeadm-bootstrap-system",
    deployment: "capi-kubeadm-bootstrap-controller-manager",
  },
];

// CAPI objects a cluster owns, i.e. whose Events belong to its activity.
const CLUSTER_OBJECT_KINDS =
  "kubeadmcontrolplanes,machinedeployments,machinesets,machines,lxcmachines,lxcclusters,kubeadmconfigs,machinehealthchecks";
const LOG_TAIL_LINES = 4000;
const ACTIVITY_TTL_MS = 3_000;
const activityCache = new Map<string, { at: number; entries: ActivityEntry[] }>();

/**
 * The cluster's activity since `since` (its creation, so an older cluster of
 * the same name does not bleed in): Events on its objects plus the provider
 * controllers' log lines about it. Several browsers polling the same cluster
 * share one read for a few seconds.
 */
export async function getClusterActivity(
  name: string,
  since: Date,
  limit: number,
): Promise<ActivityEntry[]> {
  const key = `${name}@${since.toISOString()}`;
  const cached = activityCache.get(key);
  if (cached && Date.now() - cached.at < ACTIVITY_TTL_MS) {
    return cached.entries.slice(-limit);
  }

  const opts = { env: kubeEnv(), timeoutMs: 15_000 };
  const [objects, events, ...logs] = await Promise.all([
    run(
      [
        "kubectl",
        "get",
        CLUSTER_OBJECT_KINDS,
        "-n",
        WORKLOAD_NAMESPACE,
        "-l",
        `cluster.x-k8s.io/cluster-name=${name}`,
        "-o",
        "name",
      ],
      opts,
    ),
    run(["kubectl", "get", "events", "-n", WORKLOAD_NAMESPACE, "-o", "json"], opts),
    ...CONTROLLERS.map((c) =>
      run(
        [
          "kubectl",
          "logs",
          "-n",
          c.namespace,
          `deployment/${c.deployment}`,
          `--since-time=${since.toISOString()}`,
          `--tail=${String(LOG_TAIL_LINES)}`,
        ],
        opts,
      ),
    ),
  ]);

  const names = new Set([name]);
  if (objects.ok) {
    for (const line of objects.stdout.split("\n")) {
      const slash = line.indexOf("/");
      if (slash > 0) names.add(line.slice(slash + 1).trim());
    }
  } else {
    log.warn(`activity ${name}: listing cluster objects: ${execError(objects)}`);
  }

  const sets: ActivityEntry[][] = [];
  if (events.ok) {
    sets.push(eventActivity(JSON.parse(events.stdout) as K8sEventList, names, since));
  } else {
    log.warn(`activity ${name}: kubectl get events: ${execError(events)}`);
  }
  const clusterRef = `${WORKLOAD_NAMESPACE}/${name}`;
  const now = new Date();
  CONTROLLERS.forEach((c, i) => {
    const r = logs[i];
    if (!r?.ok) {
      if (r) log.warn(`activity ${name}: ${c.deployment} logs: ${execError(r)}`);
      return;
    }
    sets.push(logActivity(r.stdout.split("\n"), c.source, clusterRef, since, now));
  });

  const entries = mergeActivity(sets, 500);
  activityCache.set(key, { at: Date.now(), entries });
  for (const [k, v] of activityCache) {
    if (Date.now() - v.at > 60_000) activityCache.delete(k);
  }
  return entries.slice(-limit);
}
