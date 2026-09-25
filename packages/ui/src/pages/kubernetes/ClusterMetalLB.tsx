import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  ConfirmationButton,
  Icon,
  MainTable,
  Modal,
  Spinner,
  usePortal,
  useToastNotification,
} from "@canonical/react-components";
import MetalLBAddressInput from "pages/kubernetes/MetalLBAddressInput";
import {
  splitAddresses,
  useChangeK8sMetalLB,
  useK8sMetalLB,
  useK8sMetalLBHint,
  type K8sMetalLB,
} from "pages/kubernetes/useK8sClusters";
import { metallbAddressesError } from "util/k8s/metallb";

interface ModalProps {
  name: string;
  current: string[];
  onClose: () => void;
}

const MetalLBAddressesModal: FC<ModalProps> = ({ name, current, onClose }) => {
  const toastNotify = useToastNotification();
  const change = useChangeK8sMetalLB(name);
  const { data: hint } = useK8sMetalLBHint(name, true);
  const [value, setValue] = useState(current.join(", "));
  const [prefilled, setPrefilled] = useState(current.length > 0);
  if (!prefilled && hint?.range) {
    setPrefilled(true);
    setValue(hint.range);
  }
  const error = metallbAddressesError(value);
  const installing = current.length === 0;

  const submit = () => {
    change.mutate(splitAddresses(value), {
      onSuccess: () => {
        toastNotify.success(
          installing
            ? `Installing MetalLB in cluster "${name}".`
            : `Updating the MetalLB address pool of cluster "${name}".`,
        );
        onClose();
      },
      onError: (e) => {
        toastNotify.failure(
          installing ? "Installing MetalLB failed" : "Updating MetalLB failed",
          e,
        );
      },
    });
  };

  return (
    <Modal
      close={onClose}
      title={installing ? "Install MetalLB" : "Change MetalLB addresses"}
      buttonRow={
        <>
          <Button
            className="u-no-margin--bottom"
            type="button"
            onClick={onClose}
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={change.isPending}
            disabled={error !== null || change.isPending}
            onClick={submit}
          >
            {installing ? "Install" : "Save"}
          </ActionButton>
        </>
      }
    >
      <MetalLBAddressInput
        id="metallb-addresses"
        value={value}
        hint={hint}
        error={value ? error : null}
        onChange={setValue}
      />
      {!installing ? (
        <p className="u-text--muted">
          Services keep the addresses they have unless those leave the pool.
        </p>
      ) : null}
    </Modal>
  );
};

const STATE_LABEL: Record<K8sMetalLB["state"], { icon: string; text: string }> =
  {
    absent: { icon: "status-waiting-small", text: "Not installed" },
    waiting: {
      icon: "status-queued-small",
      text: "Waiting for the cluster to be ready",
    },
    installing: { icon: "status-in-progress-small", text: "Installing" },
    installed: { icon: "status-succeeded-small", text: "Installed" },
    removing: { icon: "status-in-progress-small", text: "Removing" },
    failed: { icon: "status-failed-small", text: "Failed" },
  };

interface Props {
  name: string;
  /** The agent can manage MetalLB (0.3.0+). */
  supported: boolean;
}

// Service load balancer of a workload cluster (MetalLB, L2 mode).
const ClusterMetalLB: FC<Props> = ({ name, supported }) => {
  const toastNotify = useToastNotification();
  const { data, error, isLoading } = useK8sMetalLB(name, supported);
  const change = useChangeK8sMetalLB(name);
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });

  if (!supported) {
    return (
      <p className="u-text--muted">
        Update the Kubernetes agent (Kubernetes settings → Management appliance)
        to give LoadBalancer services an external IP with MetalLB.
      </p>
    );
  }
  if (isLoading) return <Spinner text="Loading..." />;
  if (error || !data) {
    return (
      <p className="u-text--muted">
        MetalLB status is not available right now
        {error ? `: ${error.message}` : ""}.
      </p>
    );
  }

  const label = STATE_LABEL[data.state];
  const busy = ["waiting", "installing", "removing"].includes(data.state);
  const remove = () => {
    change.mutate(null, {
      onSuccess: () => {
        toastNotify.success(`Removing MetalLB from cluster "${name}".`);
      },
      onError: (e) => {
        toastNotify.failure("Removing MetalLB failed", e);
      },
    });
  };

  return (
    <>
      <p>
        <Icon name={label.icon} className="status-icon" />
        {label.text}
        {data.state === "installed" && data.version ? (
          <span className="u-text--muted"> · MetalLB {data.version}</span>
        ) : null}
        {data.state === "failed" && data.error ? (
          <span className="u-text--muted"> · {data.error}</span>
        ) : null}
      </p>
      {data.addresses.length > 0 || data.requested ? (
        <p>
          <span className="u-text--muted">Address pool </span>
          <code>
            {(data.addresses.length > 0
              ? data.addresses
              : (data.requested ?? [])
            ).join(", ")}
          </code>
        </p>
      ) : null}
      {data.state === "installed" ? (
        <MainTable
          responsive
          headers={[
            { content: "Service" },
            { content: "External IP" },
            { content: "Ports" },
          ]}
          rows={data.services.map((svc) => ({
            key: `${svc.namespace}/${svc.name}`,
            columns: [
              {
                content: (
                  <>
                    <span className="u-text--muted">{svc.namespace}/</span>
                    {svc.name}
                  </>
                ),
              },
              {
                content:
                  svc.addresses.length > 0 ? (
                    <code>{svc.addresses.join(", ")}</code>
                  ) : (
                    <span className="u-text--muted">Pending</span>
                  ),
              },
              { content: svc.ports.join(", ") || "-" },
            ],
          }))}
          emptyStateMsg="No services of type LoadBalancer yet."
        />
      ) : null}
      <div className="k8s-metallb-actions">
        {data.state === "absent" || data.state === "failed" ? (
          <Button onClick={openPortal}>
            {data.state === "failed" ? "Retry install" : "Install MetalLB"}
          </Button>
        ) : null}
        {data.state === "installed" ? (
          <Button onClick={openPortal}>Change addresses</Button>
        ) : null}
        {data.state === "installed" || data.state === "failed" ? (
          <ConfirmationButton
            appearance="base"
            loading={change.isPending}
            disabled={busy || change.isPending}
            confirmationModalProps={{
              title: "Remove MetalLB",
              children: (
                <p>
                  MetalLB is removed from cluster <b>{name}</b>. Its
                  LoadBalancer services lose their external IP and go back to
                  pending.
                </p>
              ),
              confirmButtonLabel: "Remove",
              onConfirm: remove,
            }}
          >
            Remove
          </ConfirmationButton>
        ) : null}
      </div>
      {isOpen && (
        <Portal>
          <MetalLBAddressesModal
            name={name}
            current={data.state === "installed" ? data.addresses : []}
            onClose={closePortal}
          />
        </Portal>
      )}
    </>
  );
};

export default ClusterMetalLB;
