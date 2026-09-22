// Management-plane readiness (docs/k8s/management-appliance.md §5). The
// appliance comes up in stages — container running, cloud-init bootstrap
// (k3s + clusterctl init + agent), agent reachable over its self-signed TLS,
// CAPN controller available — and each stage has a different fix, so the UI
// reports which one it is stuck on instead of a single "not ready".

import type { AgentConfig, AgentInfo } from "util/k8s/agent";

export type ManagementStage =
  | "loading"
  | "not-deployed"
  | "stopped"
  | "bootstrapping"
  | "bootstrap-failed"
  | "connecting"
  | "agent-unreachable"
  | "capn-pending"
  | "incus-untrusted"
  | "ready";

export type ManagementSeverity =
  | "positive"
  | "negative"
  | "caution"
  | "information";

export interface ManagementState {
  stage: ManagementStage;
  severity: ManagementSeverity;
  title: string;
  message: string;
}

export interface CloudInitResult {
  /** /run/cloud-init/result.json exists: every stage, incl. runcmd, has run. */
  done: boolean;
  errors: string[];
}

export interface ManagementInputs {
  /** undefined while loading, null when the appliance container is absent. */
  container: { status: string } | null | undefined;
  /** null when the bootstrap state could not be read. */
  cloudInit?: CloudInitResult | null;
  agentInfo?: AgentInfo;
  agentError?: Error | null;
  /** Whether Incus trusts the appliance's client cert; undefined if unknown. */
  incusTrusted?: boolean;
}

/** Parse cloud-init's result.json, written once the final stage completes. */
export const parseCloudInitResult = (raw: string): CloudInitResult => {
  try {
    const parsed = JSON.parse(raw) as { v1?: { errors?: unknown[] } };
    const errors = (parsed.v1?.errors ?? []).map(String);
    return { done: true, errors };
  } catch {
    return { done: true, errors: ["unreadable cloud-init result"] };
  }
};

const state = (
  stage: ManagementStage,
  severity: ManagementSeverity,
  title: string,
  message: string,
): ManagementState => ({ stage, severity, title, message });

export const deriveManagementState = ({
  container,
  cloudInit,
  agentInfo,
  agentError,
  incusTrusted,
}: ManagementInputs): ManagementState => {
  if (container === undefined) {
    return state(
      "loading",
      "information",
      "Checking",
      "Checking the management appliance.",
    );
  }
  if (container === null) {
    return state(
      "not-deployed",
      "caution",
      "No management appliance",
      "Deploy a management appliance before creating clusters.",
    );
  }
  if (container.status !== "Running") {
    return state(
      "stopped",
      "caution",
      "Management appliance stopped",
      `The appliance container is ${container.status.toLowerCase()}. Start it to manage clusters.`,
    );
  }
  // A reachable agent is proof enough, whatever cloud-init says (or whether we
  // could read it at all).
  if (agentInfo) {
    if (agentInfo.capabilities.capn && incusTrusted === false) {
      return state(
        "incus-untrusted",
        "caution",
        "Appliance not trusted by Incus",
        "The agent's Incus client certificate is not in the trust store, so it cannot create cluster projects or instances.",
      );
    }
    return agentInfo.capabilities.capn
      ? state(
          "ready",
          "positive",
          "Management appliance ready",
          "Cluster API and the Incus provider (CAPN) are running.",
        )
      : state(
          "capn-pending",
          "information",
          "Cluster API starting",
          "The agent is up but the CAPN controller is not available yet.",
        );
  }
  if (cloudInit && !cloudInit.done) {
    return state(
      "bootstrapping",
      "information",
      "Bootstrapping management appliance",
      "Installing k3s, Cluster API and the agent. This takes a few minutes.",
    );
  }
  if (cloudInit && cloudInit.errors.length > 0) {
    return state(
      "bootstrap-failed",
      "negative",
      "Bootstrap failed",
      `cloud-init reported: ${cloudInit.errors.join("; ")}`,
    );
  }
  if (!agentError) {
    return state(
      "connecting",
      "information",
      "Connecting",
      "Contacting the Kubernetes agent.",
    );
  }
  return state(
    "agent-unreachable",
    "caution",
    "Agent unreachable",
    "The appliance finished bootstrapping but the agent does not answer. Approve its self-signed certificate, then retry.",
  );
};

/**
 * The persisted server-side handle (user.k8s.api-config) wins over the
 * per-browser copy, so any Incendio session reconnects to the same appliance.
 */
export const resolveAgentConfig = (
  server: AgentConfig | null,
  local: AgentConfig,
): AgentConfig =>
  server && server.url.length > 0 && server.token.length > 0
    ? { url: server.url, token: server.token }
    : local;

export type StepStatus = "pending" | "active" | "done" | "failed";

export interface ManagementStep {
  label: string;
  status: StepStatus;
}

const STEP_LABELS = [
  "Appliance container running",
  "Bootstrap: k3s, Cluster API, agent",
  "Agent reachable",
  "Cluster API provider (CAPN) ready",
  "Incus trusts the appliance",
];

// Per stage: how many leading steps are done, and the state of the next one.
const STEP_PROGRESS: Record<
  ManagementStage,
  { done: number; next: StepStatus }
> = {
  loading: { done: 0, next: "pending" },
  "not-deployed": { done: 0, next: "pending" },
  stopped: { done: 0, next: "failed" },
  bootstrapping: { done: 1, next: "active" },
  "bootstrap-failed": { done: 1, next: "failed" },
  connecting: { done: 2, next: "active" },
  "agent-unreachable": { done: 2, next: "failed" },
  "capn-pending": { done: 3, next: "active" },
  "incus-untrusted": { done: 4, next: "failed" },
  ready: { done: 5, next: "pending" },
};

/** Checklist view of the staged bring-up for the Management appliance tab. */
export const managementSteps = (stage: ManagementStage): ManagementStep[] => {
  const { done, next } = STEP_PROGRESS[stage];
  return STEP_LABELS.map((label, index) => ({
    label,
    status: index < done ? "done" : index === done ? next : "pending",
  }));
};
