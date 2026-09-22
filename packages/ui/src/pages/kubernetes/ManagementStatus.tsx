import { useState, type FC } from "react";
import {
  ActionButton,
  Icon,
  Notification,
  useToastNotification,
} from "@canonical/react-components";
import type { K8sManagement } from "pages/kubernetes/useK8sManagement";
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
