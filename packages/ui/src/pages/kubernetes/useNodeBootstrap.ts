import { useQueries } from "@tanstack/react-query";
import {
  diagnoseBootstrap,
  shouldDiagnoseBootstrap,
  type BootstrapDiagnosis,
} from "util/k8s/bootstrap";
import type { ClusterNode } from "util/k8s/clusterNodes";
import { instanceFileExists, readInstanceFile } from "util/k8s/instanceFiles";

const CLOUD_INIT_RESULT = "/var/lib/cloud/data/result.json";
const BOOTSTRAP_SENTINEL = "/run/cluster-api/bootstrap-success.complete";
const CLOUD_INIT_LOG = "/var/log/cloud-init-output.log";

const existsOrNull = async (
  project: string,
  instance: string,
  path: string,
): Promise<boolean | null> =>
  instanceFileExists(project, instance, path).catch(() => null);

const diagnose = async (
  project: string,
  instance: string,
): Promise<BootstrapDiagnosis> => {
  const [cloudInitDone, succeeded] = await Promise.all([
    existsOrNull(project, instance, CLOUD_INIT_RESULT),
    existsOrNull(project, instance, BOOTSTRAP_SENTINEL),
  ]);
  const log =
    cloudInitDone === true && succeeded === false
      ? await readInstanceFile(project, instance, CLOUD_INIT_LOG).catch(
          () => null,
        )
      : null;
  return diagnoseBootstrap({ cloudInitDone, succeeded, log });
};

/**
 * Bootstrap diagnosis for nodes that have not joined the cluster, keyed by
 * node name — read from inside each node through the Incus file API.
 */
export const useNodeBootstrap = (
  nodes: ClusterNode[],
  project: string | null,
): Map<string, BootstrapDiagnosis> => {
  const candidates = project ? nodes.filter(shouldDiagnoseBootstrap) : [];
  const results = useQueries({
    queries: candidates.map((node) => ({
      queryKey: ["k8s", "node-bootstrap", project, node.name],
      queryFn: async () => diagnose(project ?? "", node.name),
      retry: false,
      // A failed bootstrap never recovers on its own; poll it gently.
      refetchInterval: (query: { state: { data?: BootstrapDiagnosis } }) =>
        query.state.data?.state === "failed" ? 60_000 : 15_000,
    })),
  });
  const out = new Map<string, BootstrapDiagnosis>();
  candidates.forEach((node, i) => {
    const data = results[i]?.data;
    if (data) out.set(node.name, data);
  });
  return out;
};
