// Thin client for the @incendio/k8s agent. The agent is a persistent broker
// over the CAPI/CAPN control plane running in the operator VM; the UI never
// talks to Incus for Kubernetes lifecycle directly. See docs/k8s/deploy-model.md.

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
  };
  incus: { apiUrl: string; configured: boolean };
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

const trimSlash = (url: string): string => url.trim().replace(/\/+$/, "");

const extractError = (raw: unknown, status: number): string => {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const message = record.error ?? record.detail;
    if (typeof message === "string" && message.length > 0) return message;
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
  if (!res.ok) throw new Error(extractError(raw, res.status));
  return raw as T;
};
