import type { FC } from "react";
import {
  Button,
  Col,
  Icon,
  Input,
  Notification,
  Row,
} from "@canonical/react-components";
import type { K8sAgent } from "pages/kubernetes/useK8sAgent";

interface Props {
  agent: K8sAgent;
}

const K8sAgentPanel: FC<Props> = ({ agent }) => {
  return (
    <div className="u-sv3">
      <h2 className="p-heading--4">Kubernetes agent</h2>
      <p className="u-text--muted">
        Connect the <code>@incendio/k8s</code> agent to provision clusters
        directly. Without an agent, use the generator to produce artifacts you
        run yourself. The URL must be reachable from your browser (HTTPS, with
        CORS allowing this origin). Once connected, use{" "}
        <strong>Deploy management appliance</strong> on the Management appliance
        tab.
      </p>
      <Row>
        <Col size={6}>
          <Input
            type="text"
            label="Agent URL"
            value={agent.url}
            placeholder="https://operator.example.com:8843"
            onChange={(e) => {
              agent.setUrl(e.target.value);
            }}
          />
        </Col>
        <Col size={6}>
          <Input
            type="password"
            label="Agent token"
            value={agent.token}
            autoComplete="off"
            onChange={(e) => {
              agent.setToken(e.target.value);
            }}
          />
        </Col>
      </Row>
      <Button
        appearance="positive"
        hasIcon
        disabled={agent.busy || agent.url.trim().length === 0}
        onClick={() => void agent.testConnection()}
      >
        {agent.busy ? (
          <Icon className="u-animation--spin" name="spinner" />
        ) : (
          <Icon name="connected" />
        )}
        <span>Test connection</span>
      </Button>
      {agent.status ? (
        <Notification
          severity={agent.status.severity}
          onDismiss={agent.clearStatus}
        >
          {agent.status.text}
        </Notification>
      ) : null}
      {agent.url.trim().length > 0 ? (
        <p className="u-text--muted">
          Self-signed certificate?{" "}
          <a href={agent.url} target="_blank" rel="noreferrer">
            Approve K8s manager certificate
          </a>{" "}
          in a new tab, then Test connection.
        </p>
      ) : null}
    </div>
  );
};

export default K8sAgentPanel;
