import { useState } from "react";
import type { K8sClusterConfig } from "util/k8s/capn";
import {
  agentRequest,
  fetchAgentInfo,
  loadAgentConfig,
  saveAgentConfig,
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
  createCluster: (config: K8sClusterConfig) => Promise<void>;
}

// Shared broker-connection state so both the agent panel and the form footer
// operate on a single connection. The panel owns URL/token + Test connection;
// the footer drives Deploy management appliance.
export const useK8sAgent = (): K8sAgent => {
  const initial = loadAgentConfig();
  const [url, setUrl] = useState(initial.url);
  const [token, setToken] = useState(initial.token);
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
      try {
        await finalizeApiConfig(url, token, next.tls?.fingerprint ?? null);
      } catch {
        // Best-effort: pinning the fingerprint is advisory for the
        // self-signed appliance and may fail without config-write access.
      }
      return {
        severity: "positive",
        text: `Connected to ${next.name} ${next.version} — CAPN ${
          next.capabilities.capn ? "ready" : "pending"
        }, Incus ${next.incus.configured ? "configured" : "not configured"}.`,
      };
    });

  const deployAppliance = async (input: ApplianceDeployInput): Promise<void> =>
    run(async () => {
      const result = await deployManagementAppliance(input);
      setUrl(result.url);
      setToken(result.token);
      const where = result.address ? ` (container ${result.address})` : "";
      return {
        severity: "information",
        text: `Management appliance "${result.name}" is provisioning in project "${result.project}"${where}. Approve its certificate at ${result.url}, then Test connection.`,
      };
    }, false);

  const createCluster = async (config: K8sClusterConfig): Promise<void> =>
    run(async () => {
      const result = await agentRequest<{ name: string; project: string }>(
        agentConfig(),
        "/v1/clusters",
        {
          method: "POST",
          body: JSON.stringify({
            name: config.clusterName,
            kubernetesVersion: config.kubernetesVersion,
            controlPlaneCount: config.controlPlaneCount,
            workerCount: config.workerCount,
          }),
        },
      );
      return {
        severity: "positive",
        text: `Cluster "${result.name}" project "${result.project}" created. Provisioning via CAPN is pending.`,
      };
    });

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
    createCluster,
  };
};
