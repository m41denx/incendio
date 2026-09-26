import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKubeconfig } from "./capi.ts";

/**
 * Talking to a workload cluster's own API server from the appliance, with the
 * admin kubeconfig CAPI keeps for it.
 */

/** The control plane has not been initialized: nothing to talk to yet. */
export class NoKubeconfigError extends Error {}

export async function withKubeconfig<T>(
  cluster: string,
  fn: (kubeconfig: string) => Promise<T>,
): Promise<T> {
  const kubeconfig = await getKubeconfig(cluster);
  if (kubeconfig === null) {
    throw new NoKubeconfigError(
      "the cluster has no kubeconfig yet (control plane not initialized)",
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "incendio-kc-"));
  const path = join(dir, "kubeconfig");
  writeFileSync(path, kubeconfig, { mode: 0o600 });
  try {
    return await fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

