import type { FC } from "react";
import {
  ConfirmationButton,
  Icon,
  Spinner,
  useToastNotification,
} from "@canonical/react-components";
import {
  useK8sControllers,
  useRestartK8sControllers,
  type K8sControllerRestart,
} from "pages/kubernetes/useK8sControllers";
import { isoTimeToString } from "util/helpers";

const restartSummary = (restart: K8sControllerRestart): string => {
  const who = restart.automatic ? "Restarted automatically" : "Restarted";
  const outcome =
    restart.ok === undefined
      ? " (in progress)"
      : restart.ok
        ? ""
        : ` (failed: ${restart.error ?? "unknown error"})`;
  return `${who} ${isoTimeToString(restart.at)}${outcome}: ${restart.reason}`;
};

// Health of the Cluster API controllers in the appliance, and the restart that
// unsticks them after the appliance was paused or the host slept.
const ManagementControllers: FC = () => {
  const toastNotify = useToastNotification();
  const { data, error, isLoading } = useK8sControllers(true);
  const restart = useRestartK8sControllers();

  const onRestart = () => {
    restart.mutate(undefined, {
      onSuccess: () => {
        toastNotify.success("Restarting the cluster controllers.");
      },
      onError: (e) => {
        toastNotify.failure("Restarting the cluster controllers failed", e);
      },
    });
  };

  if (isLoading) return <Spinner text="Loading controllers..." />;
  if (error || !data) {
    return (
      <p className="u-text--muted">
        Controller status is not available right now
        {error ? `: ${error.message}` : ""}.
      </p>
    );
  }

  const busy = data.restarting || restart.isPending;
  return (
    <div className="u-sv2">
      <h3 className="p-heading--5">Cluster controllers</h3>
      <ul className="p-list u-no-margin--bottom">
        {data.deployments.map((d) => {
          const healthy = d.desired > 0 && d.ready >= d.desired;
          return (
            <li className="p-list__item" key={`${d.namespace}/${d.name}`}>
              <Icon
                name={
                  data.restarting
                    ? "status-in-progress-small"
                    : healthy
                      ? "status-succeeded-small"
                      : "status-failed-small"
                }
              />{" "}
              {d.name}{" "}
              <span className="u-text--muted">
                {d.ready}/{d.desired} ready
              </span>
            </li>
          );
        })}
      </ul>
      {data.unreachable.length > 0 ? (
        <p>
          <Icon name="warning" /> Cluster API cannot reach{" "}
          {data.unreachable
            .map((m) => `${m.machine} (cluster ${m.cluster})`)
            .join(", ")}{" "}
          since {isoTimeToString(data.unreachable[0].since)}. If those nodes are
          up, the controllers lost their connections, for example after the
          appliance was paused
          {data.watchdog
            ? "; the agent restarts them itself after 5 minutes"
            : ""}
          .
        </p>
      ) : null}
      {data.lastRestart ? (
        <p className="u-text--muted">{restartSummary(data.lastRestart)}</p>
      ) : null}
      <ConfirmationButton
        appearance="base"
        className="u-no-margin--bottom"
        loading={busy}
        disabled={busy}
        onHoverText="Restart the Cluster API controllers in the appliance"
        confirmationModalProps={{
          title: "Restart cluster controllers",
          children: (
            <p>
              The appliance restarts the Cluster API controllers (core, kubeadm
              control plane and bootstrap, Incus provider). Clusters and their
              nodes keep running; status updates pause for about a minute. Use
              this when clusters stay in provisioning or report reachable nodes
              as unreachable.
            </p>
          ),
          confirmButtonLabel: "Restart",
          onConfirm: onRestart,
        }}
      >
        Restart controllers
      </ConfirmationButton>
    </div>
  );
};

export default ManagementControllers;
