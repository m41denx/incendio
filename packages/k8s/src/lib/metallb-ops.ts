import { env } from "../env.ts";
import { log } from "./log.ts";
import { execError, run } from "./exec.ts";
import { getKubeconfig } from "./capi.ts";
import { NoKubeconfigError, withKubeconfig } from "./workload.ts";
import {
  buildPoolManifest,
  loadBalancerServices,
  METALLB_NAMESPACE,
  METALLB_POOL,
  type LoadBalancerService,
} from "./metallb.ts";

/**
 * MetalLB against a workload cluster, with its admin kubeconfig. Applied by
 * the agent rather than a ClusterResourceSet: the address pool can only be
 * created once MetalLB's CRDs and validating webhook are up, which a CRS
 * cannot wait for. Installs run as background jobs (a minute or two).
 */

export { NoKubeconfigError };

const manifestUrl = () =>
  env.METALLB_MANIFEST_URL ??
  `https://raw.githubusercontent.com/metallb/metallb/${env.METALLB_VERSION}/config/manifests/metallb-native.yaml`;

const kubectl = (kubeconfig: string, args: string[], input?: string, timeoutMs = 60_000) =>
  run(["kubectl", "--kubeconfig", kubeconfig, ...args], { input, timeoutMs });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function install(cluster: string, addresses: string[]): Promise<void> {
  await withKubeconfig(cluster, async (kc) => {
    const apply = await kubectl(kc, ["apply", "-f", manifestUrl()], undefined, 180_000);
    if (!apply.ok) throw new Error(`applying MetalLB failed: ${execError(apply)}`);

    for (const workload of ["deployment/controller", "daemonset/speaker"]) {
      const ready = await kubectl(
        kc,
        ["-n", METALLB_NAMESPACE, "rollout", "status", workload, "--timeout=300s"],
        undefined,
        310_000,
      );
      if (!ready.ok) throw new Error(`MetalLB ${workload} did not become ready: ${execError(ready)}`);
    }

    // The validating webhook answers a little after the controller is Ready.
    const pool = buildPoolManifest(addresses);
    let last = "";
    for (let attempt = 0; attempt < 24; attempt++) {
      const r = await kubectl(kc, ["apply", "-f", "-"], pool);
      if (r.ok) return;
      last = execError(r);
      await sleep(5_000);
    }
    throw new Error(`creating the MetalLB address pool failed: ${last}`);
  });
}

async function remove(cluster: string): Promise<void> {
  await withKubeconfig(cluster, async (kc) => {
    const del = await kubectl(
      kc,
      ["delete", "-f", manifestUrl(), "--ignore-not-found", "--wait=true", "--timeout=120s"],
      undefined,
      180_000,
    );
    if (!del.ok) throw new Error(`removing MetalLB failed: ${execError(del)}`);
  });
}

// ---- jobs -------------------------------------------------------------------

interface Job {
  action: "install" | "remove";
  running: boolean;
  error?: string;
}

const jobs = new Map<string, Job>();

function start(cluster: string, action: Job["action"], work: () => Promise<void>): void {
  if (jobs.get(cluster)?.running) return;
  const job: Job = { action, running: true };
  jobs.set(cluster, job);
  log.info(`metallb ${cluster}: ${action} started`);
  work()
    .then(() => {
      log.info(`metallb ${cluster}: ${action} done`);
      jobs.delete(cluster);
    })
    .catch((error: unknown) => {
      job.error = error instanceof Error ? error.message : String(error);
      log.error(`metallb ${cluster}: ${action} failed: ${job.error}`);
    })
    .finally(() => {
      job.running = false;
    });
}

export function startInstall(cluster: string, addresses: string[]): void {
  start(cluster, "install", () => install(cluster, addresses));
}

export function startRemove(cluster: string): void {
  start(cluster, "remove", () => remove(cluster));
}

/** Whether the workload cluster can be reached with a kubeconfig yet. */
export async function hasKubeconfig(cluster: string): Promise<boolean> {
  return (await getKubeconfig(cluster)) !== null;
}

export function forgetJob(cluster: string): void {
  if (!jobs.get(cluster)?.running) jobs.delete(cluster);
}

// ---- status -----------------------------------------------------------------

export type MetalLBState =
  | "absent"
  | "waiting" // requested at create time, cluster not ready yet
  | "installing"
  | "installed"
  | "removing"
  | "failed";

export interface MetalLBStatus {
  state: MetalLBState;
  /** Why the last install/remove failed (state "failed"). */
  error?: string;
  /** Controller image tag, when installed. */
  version?: string;
  /** Addresses of the agent's pool, when installed. */
  addresses: string[];
  services: LoadBalancerService[];
}

interface Deployment {
  status?: { readyReplicas?: number };
  spec?: { template?: { spec?: { containers?: { image?: string }[] } } };
}

/** What is installed in the workload cluster, overlaid with a running job. */
export async function metallbStatus(cluster: string): Promise<MetalLBStatus> {
  const job = jobs.get(cluster);
  const observed = await withKubeconfig(cluster, async (kc) => {
    const [deploy, pool, services] = await Promise.all([
      kubectl(kc, ["-n", METALLB_NAMESPACE, "get", "deployment", "controller", "-o", "json", "--ignore-not-found"]),
      kubectl(kc, ["-n", METALLB_NAMESPACE, "get", "ipaddresspools.metallb.io", METALLB_POOL, "-o", "json", "--ignore-not-found"]),
      kubectl(kc, ["get", "services", "-A", "-o", "json"]),
    ]);
    const deployment = deploy.ok && deploy.stdout.trim() ? (JSON.parse(deploy.stdout) as Deployment) : null;
    const image = deployment?.spec?.template?.spec?.containers?.[0]?.image ?? "";
    const poolSpec =
      pool.ok && pool.stdout.trim()
        ? (JSON.parse(pool.stdout) as { spec?: { addresses?: string[] } })
        : null;
    return {
      installed: deployment !== null,
      ready: (deployment?.status?.readyReplicas ?? 0) > 0 && poolSpec !== null,
      version: image.includes(":") ? image.slice(image.lastIndexOf(":") + 1) : undefined,
      addresses: poolSpec?.spec?.addresses ?? [],
      services: services.ok
        ? loadBalancerServices(JSON.parse(services.stdout) as { items?: [] })
        : [],
    };
  });

  const base = {
    version: observed.version,
    addresses: observed.addresses,
    services: observed.services,
  };
  if (job?.running) {
    return { ...base, state: job.action === "install" ? "installing" : "removing" };
  }
  if (job?.error) return { ...base, state: "failed", error: job.error };
  return { ...base, state: observed.ready ? "installed" : "absent" };
}
