import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import {
  MANAGEMENT_KEY,
  useAgentConfig,
} from "pages/kubernetes/useK8sManagement";
import {
  fetchAgentInfo,
  saveAgentConfig,
  verifyAgentToken,
  type AgentInfo,
} from "util/k8s/agent";
import {
  deployManagementAppliance,
  finalizeApiConfig,
  type ApplianceDeployInput,
} from "util/k8s/appliance";

export type AgentSeverity = "positive" | "negative" | "caution" | "information";

export interface AgentStatus {
  severity: AgentSeverity;
  text: string;
}

export interface K8sAgent {
  url: string;
  setUrl: (value: string) => void;
  token: string;
  setToken: (value: string) => void;
  info: AgentInfo | null;
  status: AgentStatus | null;
  clearStatus: () => void;
  busy: boolean;
  connected: boolean;
  testConnection: () => Promise<void>;
  deployAppliance: (input: ApplianceDeployInput) => Promise<void>;
}

// Shared broker-connection state so both the agent panel and the form footer
// operate on a single connection. The panel owns URL/token + Test connection;
// the footer drives Deploy management appliance.
export const useK8sAgent = (): K8sAgent => {
  const queryClient = useQueryClient();
  const resolved = useAgentConfig();
  const [url, setUrl] = useState(resolved.url);
  const [token, setToken] = useState(resolved.token);
  // Server settings load after first render; adopt the persisted handle once
  // it arrives unless the user already typed something.
  useEffect(() => {
    if (url.length === 0 && resolved.url.length > 0) setUrl(resolved.url);
    if (token.length === 0 && resolved.token.length > 0)
      setToken(resolved.token);
  }, [resolved.url, resolved.token]);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const agentConfig = () => ({ url, token });

  const run = async (
    fn: () => Promise<AgentStatus>,
    persist = true,
  ): Promise<void> => {
    setBusy(true);
    setStatus(null);
    if (persist) saveAgentConfig(agentConfig());
    try {
      setStatus(await fn());
    } catch (error) {
      setStatus({ severity: "negative", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async (): Promise<void> =>
    run(async () => {
      const next = await fetchAgentInfo(url);
      setInfo(next);
      // Only persist a handle whose token the agent actually accepts.
      await verifyAgentToken(agentConfig());
      saveAgentConfig(agentConfig());
      try {
        await finalizeApiConfig(url, token, next.tls?.fingerprint ?? null);
      } catch {
        // Best-effort: pinning the fingerprint is advisory for the
        // self-signed appliance and may fail without config-write access.
      }
      await queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
      await queryClient.invalidateQueries({ queryKey: MANAGEMENT_KEY });
      return {
        severity: "positive",
        text: `Connected to ${next.name} ${next.version} — CAPN ${
          next.capabilities.capn ? "ready" : "pending"
        }, Incus ${next.incus.configured ? "configured" : "not configured"}.`,
      };
    }, false);

  const deployAppliance = async (input: ApplianceDeployInput): Promise<void> =>
    run(async () => {
      const result = await deployManagementAppliance(input);
      setUrl(result.url);
      setToken(result.token);
      await queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
      await queryClient.invalidateQueries({ queryKey: MANAGEMENT_KEY });
      const where = result.address ? ` (container ${result.address})` : "";
      return {
        severity: "information",
        text: `Management appliance "${result.name}" is provisioning in project "${result.project}"${where}. Approve its certificate at ${result.url}, then Test connection.`,
      };
    }, false);

  return {
    url,
    setUrl,
    token,
    setToken,
    info,
    status,
    clearStatus: () => {
      setStatus(null);
    },
    busy,
    connected: info !== null,
    testConnection,
    deployAppliance,
  };
};
