import { useState, type FC } from "react";
import {
  Button,
  Col,
  Icon,
  Input,
  Notification,
  Row,
} from "@canonical/react-components";
import type { K8sClusterConfig } from "util/k8s/capn";
import {
  agentRequest,
  fetchAgentInfo,
  loadAgentConfig,
  saveAgentConfig,
  type AgentInfo,
} from "util/k8s/agent";

interface Props {
  config: K8sClusterConfig;
}

type Severity = "positive" | "negative" | "caution" | "information";

interface StatusMessage {
  severity: Severity;
  text: string;
}

const K8sAgentPanel: FC<Props> = ({ config }) => {
  const initial = loadAgentConfig();
  const [url, setUrl] = useState(initial.url);
  const [token, setToken] = useState(initial.token);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const agentConfig = () => ({ url, token });

  const run = async (
    fn: () => Promise<StatusMessage>,
    persist = true,
  ): Promise<void> => {
    setBusy(true);
    setStatus(null);
    if (persist) saveAgentConfig(agentConfig());
    try {
      setStatus(await fn());
    } catch (error) {
      setStatus({
        severity: "negative",
        text: (error as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () =>
    run(async () => {
      const next = await fetchAgentInfo(url);
      setInfo(next);
      return {
        severity: "positive",
        text: `Connected to ${next.name} ${next.version} — CAPN ${
          next.capabilities.capn ? "ready" : "pending"
        }, Incus ${next.incus.configured ? "configured" : "not configured"}.`,
      };
    });

  const deployOperator = async () =>
    run(async () => {
      const result = await agentRequest<{ project: string; name: string }>(
        agentConfig(),
        "/v1/operator",
        {
          method: "POST",
          body: JSON.stringify({
            kubernetesVersion: config.kubernetesVersion,
          }),
        },
      );
      return {
        severity: "positive",
        text: `Operator VM "${result.name}" requested in project "${result.project}". Track progress on the instance.`,
      };
    });

  const createCluster = async () =>
    run(async () => {
      const result = await agentRequest<{ name: string; project: string }>(
        agentConfig(),
        "/v1/clusters",
        {
          method: "POST",
          body: JSON.stringify({
            name: config.clusterName,
            flavor: config.flavor,
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

  const connected = info !== null;

  return (
    <div className="u-sv3">
      <h2 className="p-heading--4">Kubernetes agent</h2>
      <p className="u-text--muted">
        Configure the <code>@incendio/k8s</code> agent to provision clusters
        directly. Without an agent, use the generator below to produce artifacts
        you run yourself. The URL must be reachable from your browser (HTTPS,
        with CORS allowing this origin).
      </p>
      <Row>
        <Col size={6}>
          <Input
            type="text"
            label="Agent URL"
            value={url}
            placeholder="https://operator.example.com:8843"
            onChange={(e) => {
              setUrl(e.target.value);
            }}
          />
        </Col>
        <Col size={6}>
          <Input
            type="password"
            label="Agent token"
            value={token}
            autoComplete="off"
            onChange={(e) => {
              setToken(e.target.value);
            }}
          />
        </Col>
      </Row>
      <div className="k8s-artifact-actions">
        <Button
          appearance="positive"
          hasIcon
          disabled={busy || url.trim().length === 0}
          onClick={() => void testConnection()}
        >
          {busy ? (
            <Icon className="u-animation--spin" name="spinner" />
          ) : (
            <Icon name="connected" />
          )}
          <span>Test connection</span>
        </Button>
        <Button
          hasIcon
          disabled={busy || !connected}
          onClick={() => void deployOperator()}
        >
          <Icon name="machines" />
          <span>Deploy operator VM</span>
        </Button>
        <Button
          hasIcon
          disabled={busy || !connected}
          onClick={() => void createCluster()}
        >
          <Icon name="containers" />
          <span>Create cluster with agent</span>
        </Button>
      </div>
      {status ? (
        <Notification
          severity={status.severity}
          onDismiss={() => {
            setStatus(null);
          }}
        >
          {status.text}
        </Notification>
      ) : null}
    </div>
  );
};

export default K8sAgentPanel;
