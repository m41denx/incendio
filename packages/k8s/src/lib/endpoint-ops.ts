import { env } from "../env.ts";
import { log } from "./log.ts";
import { execError, run } from "./exec.ts";
import { WORKLOAD_NAMESPACE } from "./capi.ts";
import { ensureLoadBalancerProfile } from "./projects.ts";
import { pickEndpointAddress } from "./network-hint.ts";
import {
  applyClassPatch,
  classEndpointPatch,
  clusterClassName,
  haproxyLoadBalancer,
  LB_PROFILE,
  pinEndpoint,
  type ClusterClassObject,
  type ManifestDoc,
} from "./endpoint-pin.ts";

const kubeEnv = () => ({ KUBECONFIG: env.KUBECONFIG });

// Creates run concurrently; the class is patched by one of them at a time.
let classLock: Promise<unknown> = Promise.resolve();

/** Teach the live ClusterClass the endpoint variable (once). */
async function patchLiveClass(name: string): Promise<void> {
  const get = await run(
    ["kubectl", "get", "clusterclass", name, "-n", WORKLOAD_NAMESPACE, "-o", "json"],
    { env: kubeEnv(), timeoutMs: 15_000 },
  );
  if (!get.ok) throw new Error(`kubectl get clusterclass ${name}: ${execError(get)}`);
  const ops = classEndpointPatch(JSON.parse(get.stdout) as ClusterClassObject);
  if (ops.length === 0) return;
  const r = await run(
    [
      "kubectl",
      "patch",
      "clusterclass",
      name,
      "-n",
      WORKLOAD_NAMESPACE,
      "--type=json",
      "-p",
      JSON.stringify(ops),
    ],
    { env: kubeEnv(), timeoutMs: 20_000 },
  );
  if (!r.ok) throw new Error(`kubectl patch clusterclass ${name}: ${execError(r)}`);
  log.info(`clusterclass ${name}: added the ${LB_PROFILE} endpoint variable`);
}

/**
 * The manifest with a pinned IPv4 API endpoint (see endpoint-pin.ts), or null
 * to apply it as generated: the load balancer is not haproxy, the network has
 * no free IPv4, or a step failed (the cluster then gets CAPN's own endpoint,
 * as before). `taken`: addresses reserved elsewhere (MetalLB pools, other
 * clusters' endpoints).
 */
export async function pinClusterEndpoint(
  docs: ManifestDoc[],
  opts: { cluster: string; project: string; network: string; taken: string[] },
): Promise<{ docs: ManifestDoc[]; host: string } | null> {
  if (!haproxyLoadBalancer(docs)) return null;
  const className = clusterClassName(docs);
  if (!className) return null;
  try {
    const host = await pickEndpointAddress(opts.network, opts.taken);
    if (!host) {
      log.warn(`cluster ${opts.cluster}: no free IPv4 on ${opts.network} for the API endpoint; leaving it to CAPN`);
      return null;
    }
    await ensureLoadBalancerProfile(opts.project, LB_PROFILE, opts.network, host);
    // clusterctl ships the class with the first cluster only; later clusters
    // use the one already in the management cluster.
    let withClass = docs;
    const inManifest = docs.find(
      (d) => d.kind === "ClusterClass" && (d.metadata as { name?: string } | undefined)?.name === className,
    );
    if (inManifest) {
      const cc = inManifest as ClusterClassObject;
      const patched = applyClassPatch(cc, classEndpointPatch(cc)) as ManifestDoc;
      withClass = docs.map((d) => (d === inManifest ? patched : d));
    } else {
      const next = classLock.then(() => patchLiveClass(className));
      classLock = next.catch(() => undefined);
      await next;
    }
    const pinned = pinEndpoint(withClass, host);
    return pinned ? { docs: pinned, host } : null;
  } catch (error) {
    log.warn(
      `cluster ${opts.cluster}: pinning the API endpoint failed, leaving it to CAPN: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
