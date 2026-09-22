import {
  deriveManagementState,
  managementSteps,
  parseCloudInitResult,
  resolveAgentConfig,
} from "./management";
import type { AgentInfo } from "./agent";

const info = (capn: boolean): AgentInfo => ({
  name: "incendio-k8s",
  version: "0.1.0",
  apiVersion: "v1",
  capabilities: { capn, flavors: ["default"] },
  incus: { apiUrl: "https://10.0.0.1:8443", configured: true },
});

describe("parseCloudInitResult", () => {
  it("reports success when the errors list is empty", () => {
    expect(
      parseCloudInitResult('{"v1": {"datasource": "NoCloud", "errors": []}}'),
    ).toEqual({ done: true, errors: [] });
  });

  it("surfaces cloud-init errors (e.g. a failed bootstrap runcmd)", () => {
    expect(
      parseCloudInitResult(
        '{"v1": {"errors": ["(\'scripts_user\', RuntimeError(\'Runparts: 1 failures\'))"]}}',
      ),
    ).toEqual({
      done: true,
      errors: ["('scripts_user', RuntimeError('Runparts: 1 failures'))"],
    });
  });

  it("treats unparsable content as finished with an error", () => {
    expect(parseCloudInitResult("not json").errors).toHaveLength(1);
  });
});

describe("deriveManagementState", () => {
  it("is loading until the container lookup resolves", () => {
    expect(deriveManagementState({ container: undefined }).stage).toBe(
      "loading",
    );
  });

  it("is not-deployed when the container does not exist", () => {
    expect(deriveManagementState({ container: null }).stage).toBe(
      "not-deployed",
    );
  });

  it("is stopped when the container is not running", () => {
    expect(
      deriveManagementState({ container: { status: "Stopped" } }).stage,
    ).toBe("stopped");
  });

  it("is bootstrapping while cloud-init has not finished", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: false, errors: [] },
    });
    expect(state.stage).toBe("bootstrapping");
  });

  it("is bootstrap-failed when cloud-init finished with errors", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: true, errors: ["boom"] },
    });
    expect(state.stage).toBe("bootstrap-failed");
    expect(state.message).toContain("boom");
  });

  it("is agent-unreachable when bootstrap finished but /v1/info fails", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: true, errors: [] },
      agentError: new TypeError("Failed to fetch"),
    });
    expect(state.stage).toBe("agent-unreachable");
  });

  it("does not claim the agent is down while its handshake is in flight", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: true, errors: [] },
    });
    expect(state.stage).toBe("connecting");
  });

  it("is capn-pending when the agent answers but CAPN is not ready", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: true, errors: [] },
      agentInfo: info(false),
    });
    expect(state.stage).toBe("capn-pending");
  });

  it("is incus-untrusted when Incus does not trust the appliance cert", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: true, errors: [] },
      agentInfo: info(true),
      incusTrusted: false,
    });
    expect(state.stage).toBe("incus-untrusted");
    expect(state.severity).toBe("caution");
  });

  it("is ready when the agent reports CAPN ready", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: { done: true, errors: [] },
      agentInfo: info(true),
      incusTrusted: true,
    });
    expect(state.stage).toBe("ready");
    expect(state.severity).toBe("positive");
  });

  it("trusts a reachable agent even if cloud-init state is unknown", () => {
    const state = deriveManagementState({
      container: { status: "Running" },
      cloudInit: null,
      agentInfo: info(true),
    });
    expect(state.stage).toBe("ready");
  });
});

describe("resolveAgentConfig", () => {
  it("prefers the server-side handle so every session reconnects", () => {
    expect(
      resolveAgentConfig(
        { url: "https://a:8843", token: "server" },
        { url: "https://b:8843", token: "local" },
      ),
    ).toEqual({ url: "https://a:8843", token: "server" });
  });

  it("falls back to the per-browser config without a server handle", () => {
    expect(
      resolveAgentConfig(null, { url: "https://b:8843", token: "local" }),
    ).toEqual({ url: "https://b:8843", token: "local" });
  });
});

describe("managementSteps", () => {
  // Steps: container, bootstrap, agent, CAPN, Incus trust.
  it.each([
    ["not-deployed", ["pending", "pending", "pending", "pending", "pending"]],
    ["stopped", ["failed", "pending", "pending", "pending", "pending"]],
    ["bootstrapping", ["done", "active", "pending", "pending", "pending"]],
    ["bootstrap-failed", ["done", "failed", "pending", "pending", "pending"]],
    ["agent-unreachable", ["done", "done", "failed", "pending", "pending"]],
    ["capn-pending", ["done", "done", "done", "active", "pending"]],
    ["incus-untrusted", ["done", "done", "done", "done", "failed"]],
    ["ready", ["done", "done", "done", "done", "done"]],
  ] as const)("%s", (stage, expected) => {
    expect(managementSteps(stage).map((step) => step.status)).toEqual(expected);
  });
});
