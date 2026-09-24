// Thin client for the @incendio/k8s agent. The agent is a persistent broker
// over the CAPI/CAPN control plane running in the management appliance
// container; the UI never talks to Incus for Kubernetes lifecycle directly.
// See docs/k8s/management-appliance.md.

export interface AgentConfig {
  url: string;
  token: string;
}

export interface AgentInfo {
  name: string;
  version: string;
  apiVersion: string;
  capabilities: {
    capn: boolean;
    operator?: boolean;
    projects?: boolean;
    flavors: string[];
    roles?: string[];
    // Day-2 features; absent on agents older than 0.2.0.
    upgrade?: boolean;
    activity?: boolean;
  };
  incus: { apiUrl: string; configured: boolean };
  // SHA-256 fingerprint ("sha256:<hex>") of the agent's self-signed serving
  // cert, so the UI can pin the appliance after the user approves it.
  tls?: { fingerprint: string | null };
}

const URL_KEY = "incendio.k8s.agentUrl";
const TOKEN_KEY = "incendio.k8s.agentToken";

// Agent URL + token are stored per-browser (localStorage). The token is a
// bearer secret, so we deliberately keep it out of Incus server config.
export const loadAgentConfig = (): AgentConfig => ({
  url: localStorage.getItem(URL_KEY) ?? "",
  token: localStorage.getItem(TOKEN_KEY) ?? "",
});

export const saveAgentConfig = (config: AgentConfig): void => {
  localStorage.setItem(URL_KEY, config.url.trim());
  localStorage.setItem(TOKEN_KEY, config.token.trim());
};

const TOKEN_REJECTED =
  "The agent rejected the token. Reconnect in Kubernetes settings with the token from the latest appliance deploy (AGENT_TOKEN in /etc/incendio/agent.env inside the appliance).";

const trimSlash = (url: string): string => url.trim().replace(/\/+$/, "");

// The agent returns `{ error, detail }`: `error` is a generic summary and
// `detail` carries the real cause (Incus/TLS/CAPN), so show both. Request
// validation failures (422) come from Elysia as `{ type, message, ... }`.
const extractError = (raw: unknown, status: number): string => {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const parts = [record.error, record.detail].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (parts.length > 0) return parts.join(": ");
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
  }
  return `agent responded ${status}`;
};

/** Unauthenticated handshake used to gate the UI on a reachable agent. */
export const fetchAgentInfo = async (url: string): Promise<AgentInfo> => {
  const res = await fetch(`${trimSlash(url)}/v1/info`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`agent responded ${res.status}`);
  return (await res.json()) as AgentInfo;
};

/** Authenticated request against the agent, carrying the bearer token. */
export const agentRequest = async <T>(
  config: AgentConfig,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const res = await fetch(`${trimSlash(config.url)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const raw: unknown = text ? JSON.parse(text) : {};
  if (res.status === 401) throw new Error(TOKEN_REJECTED);
  if (!res.ok) throw new Error(extractError(raw, res.status));
  return raw as T;
};

/**
 * Prove the token works before persisting it: /v1/info is unauthenticated, so
 * a successful handshake says nothing about the token. Saving an unverified
 * one would overwrite the good handle in user.k8s.api-config for everyone.
 */
export const verifyAgentToken = async (config: AgentConfig): Promise<void> => {
  const res = await fetch(`${trimSlash(config.url)}/v1/clusters`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
    },
  });
  if (res.status === 401) {
    throw new Error(TOKEN_REJECTED);
  }
  if (!res.ok) throw new Error(`agent responded ${res.status}`);
};
