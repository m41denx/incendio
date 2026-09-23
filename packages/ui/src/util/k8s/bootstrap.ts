import type { ClusterNode } from "util/k8s/clusterNodes";

// Why a Kubernetes node never joined its cluster. CAPI's kubeadm bootstrap
// runs once from cloud-init and writes /run/cluster-api/bootstrap-success.complete
// only if kubeadm succeeded (bootstrap provider contract). cloud-init itself
// reports "done" even when kubeadm failed, so "cloud-init finished + no
// sentinel" is the failure signal, and its output log holds the reason.

export type BootstrapState = "running" | "succeeded" | "failed" | "unknown";

export interface BootstrapDiagnosis {
  state: BootstrapState;
  /** The line that explains the failure (e.g. kubeadm's [ERROR NumCPU]). */
  reason?: string;
  /** Last lines of cloud-init's output log, for context. */
  logTail?: string;
}

export interface BootstrapInputs {
  /** cloud-init's result.json exists; null if it could not be read. */
  cloudInitDone: boolean | null;
  /** CAPI's bootstrap sentinel exists; null if it could not be read. */
  succeeded: boolean | null;
  /** /var/log/cloud-init-output.log, if read. */
  log: string | null;
}

const LOG_TAIL_LINES = 30;

/** The most telling error line in a cloud-init/kubeadm log. */
export const extractBootstrapError = (log: string): string | null => {
  const lines = log.split("\n").map((line) => line.trim());
  const kubeadmErrors = lines.filter((line) => /^\[ERROR [^\]]+\]/.test(line));
  if (kubeadmErrors.length > 0) return kubeadmErrors.join("; ");
  const errorLine = [...lines].reverse().find((line) => /^error\b/i.test(line));
  return errorLine ?? null;
};

export const diagnoseBootstrap = ({
  cloudInitDone,
  succeeded,
  log,
}: BootstrapInputs): BootstrapDiagnosis => {
  if (succeeded === true) return { state: "succeeded" };
  if (cloudInitDone === false) return { state: "running" };
  if (cloudInitDone === true && succeeded === false) {
    return {
      state: "failed",
      reason:
        (log ? extractBootstrapError(log) : null) ??
        "kubeadm did not complete (no Cluster API bootstrap success marker)",
      logTail: log
        ? log.trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n")
        : undefined,
    };
  }
  return { state: "unknown" };
};

/**
 * Only nodes whose CAPI machine never joined are worth diagnosing: the success
 * sentinel lives on /run, so a joined node that later rebooted would look
 * "failed" too. Load balancers have no machine and no kubeadm.
 */
export const shouldDiagnoseBootstrap = (node: ClusterNode): boolean =>
  node.instance?.status === "Running" &&
  node.machine !== undefined &&
  !node.machine.nodeName;
