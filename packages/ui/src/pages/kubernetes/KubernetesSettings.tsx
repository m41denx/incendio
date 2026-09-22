import type { FC } from "react";
import { useParams } from "react-router-dom";
import {
  ActionButton,
  Button,
  Icon,
  Input,
  Notification,
  Row,
  Textarea,
  useNotify,
} from "@canonical/react-components";
import BaseLayout from "components/BaseLayout";
import NotificationRow from "components/NotificationRow";
import TabLinks from "components/TabLinks";
import { useAuth } from "context/auth";
import K8sAgentPanel from "pages/kubernetes/K8sAgentPanel";
import { useK8sAgent } from "pages/kubernetes/useK8sAgent";
import { useIncusCredentials } from "pages/kubernetes/useIncusCredentials";
import { ROOT_PATH } from "util/rootPath";

const AGENT = "Agent";
const APPLIANCE = "Management appliance";
const TABS = [AGENT, APPLIANCE];

// Kubernetes settings: agent connection (test + approve self-signed cert) and
// the one-time management-appliance deploy. Per-cluster definition lives in the
// separate create flow; this view is infrastructure/agent configuration.
const KubernetesSettings: FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const notify = useNotify();
  const { isFineGrained } = useAuth();
  const agent = useK8sAgent();
  const {
    serverUrl,
    setServerUrl,
    serverCrt,
    setServerCrt,
    clientCrt,
    setClientCrt,
    clientKey,
    setClientKey,
    isGenerating,
    generateCredential,
  } = useIncusCredentials();

  const deploy = () => {
    if (!serverCrt || !clientCrt || !clientKey) {
      notify.info(
        "Generate or paste Incus infrastructure credentials before deploying the management appliance.",
      );
      return;
    }
    void agent.deployAppliance({
      credentials: {
        incusApiUrl: serverUrl.trim(),
        clientCrt,
        clientKey,
        serverCrt,
      },
      isFineGrained,
    });
  };

  return (
    <BaseLayout title="Kubernetes settings">
      <NotificationRow />
      <Row>
        <TabLinks
          tabs={TABS}
          activeTab={tab}
          tabUrl={`${ROOT_PATH}/ui/kubernetes/settings`}
        />

        {!tab ? (
          <div role="tabpanel" aria-labelledby="agent">
            <K8sAgentPanel agent={agent} />
          </div>
        ) : null}

        {tab === "management-appliance" ? (
          <div role="tabpanel" aria-labelledby="management-appliance">
            <h2 className="p-heading--4">Management appliance</h2>
            <p className="u-text--muted">
              Deploy a privileged, nested Incus container running single-node
              k3s + Cluster API (CAPN) + the Incendio agent. The agent inside
              the container uses these Incus credentials to manage workload
              clusters. The client certificate must be trusted on your Incus
              server.
            </p>
            <Input
              type="text"
              label="Incus server URL"
              value={serverUrl}
              placeholder="https://incus.example.com:8443"
              onChange={(e) => {
                setServerUrl(e.target.value);
              }}
            />
            <Textarea
              label="Server certificate (PEM)"
              rows={4}
              value={serverCrt}
              placeholder="-----BEGIN CERTIFICATE-----"
              onChange={(e) => {
                setServerCrt(e.target.value);
              }}
            />
            <Button
              hasIcon
              onClick={generateCredential}
              disabled={isGenerating}
              aria-label={
                isGenerating
                  ? "Generating client certificate"
                  : "Generate client certificate"
              }
            >
              {isGenerating ? (
                <Icon className="u-animation--spin" name="spinner" />
              ) : (
                <Icon name="security" />
              )}
              <span>
                {isGenerating
                  ? "Generating\u2026"
                  : "Generate client certificate & key"}
              </span>
            </Button>
            <Textarea
              label="Client certificate (PEM)"
              rows={4}
              value={clientCrt}
              placeholder="-----BEGIN CERTIFICATE-----"
              onChange={(e) => {
                setClientCrt(e.target.value);
              }}
            />
            <Textarea
              label="Client key (PEM)"
              rows={4}
              value={clientKey}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
              onChange={(e) => {
                setClientKey(e.target.value);
              }}
            />
            <ActionButton
              appearance="positive"
              loading={agent.busy}
              onClick={deploy}
            >
              Deploy management appliance
            </ActionButton>
            {agent.status ? (
              <Notification
                severity={agent.status.severity}
                onDismiss={agent.clearStatus}
              >
                {agent.status.text}
              </Notification>
            ) : null}
          </div>
        ) : null}
      </Row>
    </BaseLayout>
  );
};

export default KubernetesSettings;
