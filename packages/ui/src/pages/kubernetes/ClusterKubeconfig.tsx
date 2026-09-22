import { useState, type FC } from "react";
import { Button, Icon, Notification } from "@canonical/react-components";
import CopyToClipboard from "components/CopyToClipboard";
import { downloadText } from "util/k8s/download";
import { useK8sKubeconfig } from "pages/kubernetes/useK8sClusters";

interface Props {
  name: string;
  /** Workload API endpoint the kubeconfig points at, for the reachability hint. */
  endpoint?: string;
}

// Admin kubeconfig for a workload cluster. Only fetched once the user asks for
// it, and never polled: it grants full cluster-admin access.
const ClusterKubeconfig: FC<Props> = ({ name, endpoint }) => {
  const [requested, setRequested] = useState(false);
  const {
    data: kubeconfig,
    error,
    isFetching,
  } = useK8sKubeconfig(name, requested);
  const filename = `${name}.kubeconfig`;

  if (!requested) {
    return (
      <Button
        hasIcon
        onClick={() => {
          setRequested(true);
        }}
      >
        <Icon name="show" />
        <span>Show kubeconfig</span>
      </Button>
    );
  }

  if (error) {
    return (
      <Notification severity="negative" title="Kubeconfig unavailable">
        {error.message}{" "}
        <Button
          appearance="link"
          dense
          onClick={() => {
            setRequested(false);
          }}
        >
          Retry
        </Button>
      </Notification>
    );
  }

  if (isFetching || !kubeconfig) {
    return (
      <p>
        <Icon className="u-animation--spin" name="spinner" /> Loading
        kubeconfig…
      </p>
    );
  }

  return (
    <div className="u-sv3">
      <div className="k8s-artifact-header">
        <p className="u-text--muted u-no-margin--bottom">
          Cluster-admin credentials.
          {endpoint ? (
            <>
              {" "}
              The API server <code>{endpoint}</code> must be reachable from
              where you run <code>kubectl</code>.
            </>
          ) : null}
        </p>
        <div className="k8s-artifact-actions">
          <CopyToClipboard
            value={kubeconfig}
            tooltipMessage="Copy kubeconfig"
          />
          <Button
            appearance="base"
            hasIcon
            className="u-no-margin--bottom"
            onClick={() => {
              downloadText(filename, kubeconfig);
            }}
          >
            <Icon name="begin-downloading" />
            <span>Download</span>
          </Button>
          <Button
            appearance="base"
            hasIcon
            className="u-no-margin--bottom"
            onClick={() => {
              setRequested(false);
            }}
          >
            <Icon name="hide" />
            <span>Hide</span>
          </Button>
        </div>
      </div>
      <pre className="p-code-snippet__block u-no-margin--bottom">
        {kubeconfig}
      </pre>
    </div>
  );
};

export default ClusterKubeconfig;
