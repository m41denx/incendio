import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { fetchAgentInfo, type AgentInfo } from "util/k8s/agent";
import { APPLIANCE_NAME, MGMT_PROJECT } from "util/k8s/appliance";
import {
  buildAgentUpdateScript,
  isAgentUpdateAvailable,
  manifestCheckCommand,
  parseAgentManifest,
  type AgentManifest,
} from "util/k8s/agentUpdate";
import { execInInstance, type ExecResult } from "util/k8s/instanceExec";
import { MANAGEMENT_KEY } from "pages/kubernetes/useK8sManagement";

const RESTART_TIMEOUT_MS = 60_000;

const execError = (result: ExecResult): Error =>
  new Error(
    result.stderr.trim() ||
      result.stdout.trim() ||
      `exited with code ${String(result.code)}`,
  );

const runInAppliance = async (command: string[]): Promise<string> => {
  const result = await execInInstance(MGMT_PROJECT, APPLIANCE_NAME, command);
  if (result.code !== 0) throw execError(result);
  return result.stdout;
};

/** Wait for the restarted agent to answer with the new version. */
const waitForVersion = async (url: string, version: string): Promise<void> => {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetchAgentInfo(url)).version === version) return;
    } catch {
      // Restarting: not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `the agent did not come back as ${version} within ${String(RESTART_TIMEOUT_MS / 1000)}s; check \`journalctl -u incendio-k8s\` in the appliance (the previous binary is kept as /usr/local/bin/incendio-k8s.prev)`,
  );
};

export interface AgentUpdate {
  /** Latest agent release, read from inside the appliance. */
  latest: AgentManifest | undefined;
  checkError: Error | null;
  available: boolean;
  update: UseMutationResult<void, Error, void>;
}

export const useAgentUpdate = (
  running: boolean,
  info: AgentInfo | undefined,
  agentUrl: string,
): AgentUpdate => {
  const queryClient = useQueryClient();
  const { data: latest, error: checkError } = useQuery({
    queryKey: [...MANAGEMENT_KEY, "agent-release"],
    queryFn: async () =>
      parseAgentManifest(await runInAppliance(manifestCheckCommand())),
    enabled: running && info !== undefined,
    retry: false,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!latest) throw new Error("no agent release to install");
      await runInAppliance(["sh", "-c", buildAgentUpdateScript(latest)]);
      await waitForVersion(agentUrl, latest.version);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: MANAGEMENT_KEY });
    },
  });

  return {
    latest,
    checkError,
    available: isAgentUpdateAvailable(info?.version, latest?.version),
    update,
  };
};
