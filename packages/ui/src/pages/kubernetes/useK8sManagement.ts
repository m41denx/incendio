import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "context/auth";
import { useSettings } from "context/useSettings";
import { fetchInstance } from "api/instances";
import { LxdApiError } from "util/helpers";
import { instanceFileExists, readInstanceFile } from "util/k8s/instanceFiles";
import {
  fetchAgentInfo,
  loadAgentConfig,
  type AgentConfig,
  type AgentInfo,
} from "util/k8s/agent";
import {
  APPLIANCE_NAME,
  MGMT_PROJECT,
  readApiConfig,
} from "util/k8s/appliance";
import {
  deriveManagementState,
  parseCloudInitResult,
  resolveAgentConfig,
  type CloudInitResult,
  type ManagementState,
} from "util/k8s/management";
import {
  isCertificateTrusted,
  trustApplianceCertificate,
} from "util/k8s/trust";
import type { LxdInstance } from "types/instance";

// The real file, not /run/cloud-init/result.json: that is a symlink, and the
// Incus file API returns a symlink's target path rather than its contents.
const CLOUD_INIT_RESULT = "/var/lib/cloud/data/result.json";
const CLOUD_INIT_LOG = "/var/log/cloud-init-output.log";
const CLOUD_INIT_BIN = "/usr/bin/cloud-init";
// Incus client cert the agent (and CAPN) authenticate with.
const APPLIANCE_CLIENT_CERT = "/etc/incendio/client.crt";
const NO_CLOUD_INIT =
  "cloud-init is not installed in the appliance image, so the bootstrap never ran. Delete the container and redeploy.";
const LOG_TAIL_LINES = 40;

// Poll quickly while the appliance is coming up, then settle down.
const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 30_000;

export const MANAGEMENT_KEY = ["k8s", "management"];

const isNotFound = (error: unknown): boolean =>
  error instanceof LxdApiError && error.status === 404;

const readApplianceFile = async (path: string): Promise<string | null> =>
  readInstanceFile(MGMT_PROJECT, APPLIANCE_NAME, path);

const applianceFileExists = async (path: string): Promise<boolean> =>
  instanceFileExists(MGMT_PROJECT, APPLIANCE_NAME, path);

export interface K8sManagement {
  state: ManagementState;
  config: AgentConfig;
  info: AgentInfo | undefined;
  container: LxdInstance | null | undefined;
  /** Tail of the cloud-init output log, when requested. */
  log: string | undefined;
  /** Add the appliance's client cert to the Incus trust store. */
  trustAppliance: () => Promise<void>;
}

/** Agent handle: server-side user.k8s.api-config, else this browser's copy. */
export const useAgentConfig = (): AgentConfig => {
  const { data: settings } = useSettings();
  return resolveAgentConfig(readApiConfig(settings), loadAgentConfig());
};

/**
 * Staged readiness of the management plane, shared by the Clusters page (gate
 * + notice) and the Management appliance tab (status + bootstrap log).
 */
export const useK8sManagement = (
  options: { withLog?: boolean } = {},
): K8sManagement => {
  const { isFineGrained } = useAuth();
  const config = useAgentConfig();

  const { data: container } = useQuery({
    queryKey: [...MANAGEMENT_KEY, "container"],
    queryFn: async () => {
      try {
        return await fetchInstance(
          APPLIANCE_NAME,
          MGMT_PROJECT,
          isFineGrained,
          false,
        );
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    enabled: isFineGrained !== null,
    retry: false,
    refetchInterval: FAST_POLL_MS,
  });
  const running = container?.status === "Running";

  const agentQuery = useQuery({
    queryKey: [...MANAGEMENT_KEY, "info", config.url],
    queryFn: async () => fetchAgentInfo(config.url),
    enabled: running && config.url.length > 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.capabilities.capn ? SLOW_POLL_MS : FAST_POLL_MS,
  });

  const { data: cloudInit } = useQuery({
    queryKey: [...MANAGEMENT_KEY, "cloud-init"],
    queryFn: async (): Promise<CloudInitResult | null> => {
      try {
        const raw = await readApplianceFile(CLOUD_INIT_RESULT);
        if (raw !== null) return parseCloudInitResult(raw);
        // No result yet: still running, unless cloud-init is not even there
        // (an image without it silently ignores the bootstrap user-data).
        return (await applianceFileExists(CLOUD_INIT_BIN))
          ? { done: false, errors: [] }
          : { done: true, errors: [NO_CLOUD_INIT] };
      } catch {
        return null;
      }
    },
    // Only needed to explain why the agent is not answering yet.
    enabled: running && !agentQuery.data,
    refetchInterval: FAST_POLL_MS,
  });

  const { data: log } = useQuery({
    queryKey: [...MANAGEMENT_KEY, "log"],
    queryFn: async () => {
      const raw = await readApplianceFile(CLOUD_INIT_LOG);
      return (raw ?? "")
        .trimEnd()
        .split("\n")
        .slice(-LOG_TAIL_LINES)
        .join("\n");
    },
    enabled: running && options.withLog === true,
    refetchInterval: (query) =>
      agentQuery.data?.capabilities.capn || query.state.error
        ? false
        : FAST_POLL_MS,
  });

  // Read the cert the agent actually uses (not whatever the form holds), so
  // this also catches appliances deployed before trust-on-deploy existed.
  const { data: trust } = useQuery({
    queryKey: [...MANAGEMENT_KEY, "trust"],
    queryFn: async () => {
      const pem = await readApplianceFile(APPLIANCE_CLIENT_CERT);
      if (pem === null) return null;
      return { pem, trusted: await isCertificateTrusted(pem) };
    },
    enabled: running && agentQuery.data !== undefined,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.trusted ? SLOW_POLL_MS : FAST_POLL_MS,
  });

  const queryClient = useQueryClient();
  const trustAppliance = async (): Promise<void> => {
    if (!trust?.pem) throw new Error("Appliance client certificate not found");
    await trustApplianceCertificate(trust.pem);
    await queryClient.invalidateQueries({ queryKey: MANAGEMENT_KEY });
  };

  const state = deriveManagementState({
    container:
      container === undefined
        ? undefined
        : container === null
          ? null
          : { status: container.status },
    cloudInit,
    agentInfo: agentQuery.data,
    agentError: agentQuery.error,
    incusTrusted: trust ? trust.trusted : undefined,
  });

  return {
    state,
    config,
    info: agentQuery.data,
    container,
    log,
    trustAppliance,
  };
};
