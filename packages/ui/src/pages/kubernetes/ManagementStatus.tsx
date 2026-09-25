import { useState, type FC } from "react";
import {
  ActionButton,
  ConfirmationButton,
  Icon,
  Notification,
  useToastNotification,
} from "@canonical/react-components";
import type { K8sManagement } from "pages/kubernetes/useK8sManagement";
import { useAgentUpdate } from "pages/kubernetes/useAgentUpdate";
import { managementSteps, type StepStatus } from "util/k8s/management";

const STEP_ICON: Record<StepStatus, string> = {
  done: "status-succeeded-small",
  active: "status-in-progress-small",
  failed: "status-failed-small",
  pending: "status-waiting-small",
};

interface Props {
  management: K8sManagement;
}

// Bring-up checklist + bootstrap log for a deployed management appliance.
const ManagementStatus: FC<Props> = ({ management }) => {
  const { state, config, info, container, log, trustAppliance } = management;
  const toastNotify = useToastNotification();
  const [trusting, setTrusting] = useState(false);
  const agentUpdate = useAgentUpdate(
    container?.status === "Running",
    info,
    config.url,
  );

  const trust = () => {
    setTrusting(true);
    trustAppliance()
      .then(() => {
        toastNotify.success(
          "Appliance certificate added to the Incus trust store.",
        );
      })
      .catch((error: Error) => {
        toastNotify.failure("Trusting the appliance certificate failed", error);
      })
      .finally(() => {
        setTrusting(false);
      });
  };
  const installUpdate = () => {
    const version = agentUpdate.latest?.version ?? "";
    agentUpdate.update.mutate(undefined, {
      onSuccess: () => {
        toastNotify.success(`Kubernetes agent updated to ${version}.`);
      },
      onError: (error) => {
        toastNotify.failure("Updating the Kubernetes agent failed", error);
      },
    });
  };
  const rollBack = () => {
    agentUpdate.rollback.mutate(undefined, {
      onSuccess: () => {
        toastNotify.success("Kubernetes agent rolled back.");
      },
      onError: (error) => {
        toastNotify.failure("Rolling back the Kubernetes agent failed", error);
      },
    });
  };
  const address = container?.state?.network
    ? Object.entries(container.state.network)
        .filter(([iface]) => iface !== "lo")
        .flatMap(([, net]) => net.addresses)
        .find((a) => a.family === "inet" && a.scope === "global")?.address
    : undefined;

  return (
    <div className="u-sv3">
      <Notification severity={state.severity} title={state.title}>
        {state.message}
        {state.stage === "agent-unreachable" && config.url ? (
          <>
            {" "}
            <a href={config.url} target="_blank" rel="noreferrer">
              Approve K8s manager certificate
            </a>
          </>
        ) : null}
      </Notification>
      {state.stage === "incus-untrusted" ? (
        <ActionButton appearance="positive" loading={trusting} onClick={trust}>
          Trust appliance certificate
        </ActionButton>
      ) : null}
      <ul className="p-list u-no-margin--bottom">
        {managementSteps(state.stage).map((step) => (
          <li className="p-list__item" key={step.label}>
            <Icon name={STEP_ICON[step.status]} /> {step.label}
          </li>
        ))}
      </ul>
      <p className="u-text--muted">
        Container <code>{container?.name}</code> in project{" "}
        <code>{container?.project}</code>
        {address ? (
          <>
            {" "}
            at <code>{address}</code>
          </>
        ) : null}
        {config.url ? (
          <>
            {" "}
            · agent <code>{config.url}</code>
          </>
        ) : null}
        {info ? (
          <>
            {" "}
            · {info.name} {info.version}
          </>
        ) : null}
      </p>
      {info && agentUpdate.canRollback ? (
        <ConfirmationButton
          appearance="base"
          className="u-no-margin--bottom"
          loading={agentUpdate.rollback.isPending}
          disabled={
            agentUpdate.rollback.isPending || agentUpdate.update.isPending
          }
          onHoverText="Go back to the agent binary the last update replaced"
          confirmationModalProps={{
            title: "Roll back the Kubernetes agent",
            children: (
              <p>
                The appliance swaps the running agent ({info.version}) with the
                binary the last update replaced and restarts it. Clusters keep
                running. Rolling back again returns to {info.version}.
              </p>
            ),
            confirmButtonLabel: "Roll back",
            onConfirm: rollBack,
          }}
        >
          Roll back agent
        </ConfirmationButton>
      ) : null}
      {info && agentUpdate.available && agentUpdate.latest ? (
        <Notification severity="information" title="Agent update available">
          <p>
            Version <strong>{agentUpdate.latest.version}</strong> of the
            Kubernetes agent is available (this appliance runs {info.version}).
            The appliance downloads it, checks its checksum and restarts the
            agent; clusters keep running meanwhile.
          </p>
          <ActionButton
            appearance="positive"
            loading={agentUpdate.update.isPending}
            disabled={agentUpdate.update.isPending}
            onClick={installUpdate}
          >
            Update agent
          </ActionButton>
        </Notification>
      ) : null}
      {log && state.stage !== "ready" ? (
        <>
          <h3 className="p-heading--5">Bootstrap log</h3>
          <pre className="p-code-snippet__block u-no-margin--bottom">{log}</pre>
        </>
      ) : null}
    </div>
  );
};

export default ManagementStatus;
