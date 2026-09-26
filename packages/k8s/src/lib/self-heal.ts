import { env } from "../env.ts";
import { auditRepo } from "../db/repo.ts";
import { log } from "./log.ts";
import { execError, run } from "./exec.ts";
import { capnReady, CONTROLLERS, WORKLOAD_NAMESPACE } from "./capi.ts";
import { withKubeconfig } from "./workload.ts";
import { staleInspections, type MachineObject, type StaleMachine } from "./controller-health.ts";

/**
 * Restarting the Cluster API controllers, on request or when the watchdog
 * sees them stuck on stale workload connections (controller-health.ts).
 *
 * This is the one loop the agent runs. It does not reconcile anything; it
 * only notices the controllers need the restart an operator would give them.
 */

// How long a node must look unreachable before the watchdog acts, how long it
// then waits before it may act again, and how often it looks.
const STALE_AFTER_MS = 5 * 60_000;
const COOLDOWN_MS = 15 * 60_000;
const INTERVAL_MS = 60_000;
// Restarts in a row that did not help before the watchdog stops trying.
const MAX_ATTEMPTS = 2;

const kubeEnv = () => ({ KUBECONFIG: env.KUBECONFIG });

export interface ControllerRestart {
  at: string;
  reason: string;
  automatic: boolean;
  /** Absent while the restart is still rolling out. */
  ok?: boolean;
  error?: string;
}

let last: ControllerRestart | undefined;
let restarting = false;
let attempts = 0;

/** A restart is already rolling out. */
export class RestartInProgress extends Error {}

async function rollOut(): Promise<void> {
  const restart = await Promise.all(
    CONTROLLERS.map((c) =>
      run(["kubectl", "-n", c.namespace, "rollout", "restart", `deployment/${c.deployment}`], {
        env: kubeEnv(),
        timeoutMs: 20_000,
      }),
    ),
  );
  const failed = restart.find((r) => !r.ok);
  if (failed) throw new Error(`kubectl rollout restart: ${execError(failed)}`);
  const status = await Promise.all(
    CONTROLLERS.map((c) =>
      run(
        [
          "kubectl",
          "-n",
          c.namespace,
          "rollout",
          "status",
          `deployment/${c.deployment}`,
          "--timeout=180s",
        ],
        { env: kubeEnv(), timeoutMs: 190_000 },
      ),
    ),
  );
  const stuck = status.findIndex((r) => !r.ok);
  if (stuck >= 0) {
    throw new Error(
      `${CONTROLLERS[stuck]!.deployment} did not come back: ${execError(status[stuck]!)}`,
    );
  }
}

/**
 * Restart the four controller deployments (core, kubeadm control plane and
 * bootstrap, CAPN) in the background. Throws RestartInProgress when one is
 * already running.
 */
export function restartControllers(reason: string, automatic: boolean): ControllerRestart {
  if (restarting) throw new RestartInProgress("the controllers are already restarting");
  restarting = true;
  const entry: ControllerRestart = { at: new Date().toISOString(), reason, automatic };
  last = entry;
  auditRepo.record("controllers.restart", reason, automatic ? "watchdog" : undefined);
  log.info(`restarting cluster controllers (${automatic ? "watchdog" : "requested"}): ${reason}`);
  void rollOut()
    .then(() => {
      entry.ok = true;
      log.info("cluster controllers restarted");
    })
    .catch((error: unknown) => {
      entry.ok = false;
      entry.error = error instanceof Error ? error.message : String(error);
      log.error(`restarting cluster controllers failed: ${entry.error}`);
    })
    .finally(() => {
      restarting = false;
    });
  return entry;
}

async function listMachines(): Promise<{ items?: MachineObject[] }> {
  const r = await run(["kubectl", "get", "machines", "-n", WORKLOAD_NAMESPACE, "-o", "json"], {
    env: kubeEnv(),
    timeoutMs: 15_000,
  });
  if (!r.ok) throw new Error(`kubectl get machines failed: ${execError(r)}`);
  return JSON.parse(r.stdout) as { items?: MachineObject[] };
}

/** The workload cluster's API server answers the appliance. */
async function workloadAnswers(cluster: string): Promise<boolean> {
  try {
    return await withKubeconfig(cluster, async (kc) => {
      const r = await run(["kubectl", "--kubeconfig", kc, "get", "--raw", "/readyz"], {
        timeoutMs: 15_000,
      });
      return r.ok;
    });
  } catch {
    return false;
  }
}

export interface ControllerHealth {
  deployments: { namespace: string; name: string; ready: number; desired: number }[];
  /** Nodes Cluster API currently cannot inspect (any age). */
  unreachable: StaleMachine[];
  restarting: boolean;
  lastRestart?: ControllerRestart;
  watchdog: boolean;
}

export async function controllerHealth(): Promise<ControllerHealth> {
  const [deployments, machines] = await Promise.all([
    Promise.all(
      CONTROLLERS.map(async (c) => {
        const r = await run(
          ["kubectl", "-n", c.namespace, "get", "deployment", c.deployment, "-o", "json"],
          { env: kubeEnv(), timeoutMs: 15_000 },
        );
        const d = r.ok
          ? (JSON.parse(r.stdout) as {
              spec?: { replicas?: number };
              status?: { readyReplicas?: number };
            })
          : {};
        return {
          namespace: c.namespace,
          name: c.deployment,
          ready: d.status?.readyReplicas ?? 0,
          desired: d.spec?.replicas ?? 0,
        };
      }),
    ),
    listMachines().catch(() => ({ items: [] })),
  ]);
  return {
    deployments,
    unreachable: staleInspections(machines, new Date(), 0),
    restarting,
    lastRestart: last,
    watchdog: env.CONTROLLER_WATCHDOG,
  };
}

async function tick(): Promise<void> {
  if (restarting) return;
  if (last && Date.now() - Date.parse(last.at) < COOLDOWN_MS) return;
  if (!(await capnReady())) return;
  const stale = staleInspections(await listMachines(), new Date(), STALE_AFTER_MS);
  if (stale.length === 0) {
    attempts = 0;
    return;
  }
  if (attempts >= MAX_ATTEMPTS) return;
  // A node the appliance cannot reach either is a real outage, not stale
  // connections; restarting the controllers would not help.
  for (const cluster of new Set(stale.map((s) => s.cluster))) {
    if (!(await workloadAnswers(cluster))) continue;
    const m = stale.find((s) => s.cluster === cluster)!;
    const minutes = Math.round((Date.now() - Date.parse(m.since)) / 60_000);
    attempts++;
    if (attempts === MAX_ATTEMPTS) {
      log.warn(`watchdog: last automatic controller restart for now (${MAX_ATTEMPTS} in a row)`);
    }
    restartControllers(
      `${m.machine} of cluster ${cluster} reported "${m.message}" for ${String(minutes)} min while its API server answers`,
      true,
    );
    return;
  }
}

/** Start the watchdog (unless CONTROLLER_WATCHDOG=false). */
export function startWatchdog(): void {
  if (!env.CONTROLLER_WATCHDOG) return;
  setInterval(() => {
    tick().catch((error: unknown) => {
      log.warn(`watchdog: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, INTERVAL_MS);
}
