import type { FC } from "react";
import { Icon } from "@canonical/react-components";
import type { K8sCluster, K8sStatus as Status } from "../../api/types";

const ICON: Record<Status, string> = {
  creating: "status-in-progress-small",
  provisioning: "status-in-progress-small",
  deleting: "status-in-progress-small",
  ready: "status-succeeded-small",
  degraded: "status-waiting-small",
  error: "status-failed-small",
};
const LABEL: Record<Status, string> = { creating: "Creating", provisioning: "Provisioning", ready: "Ready", degraded: "Degraded", deleting: "Deleting", error: "Error" };

/** While a job owns the cluster nothing else changes it, and its page keeps refreshing. */
export const busy = (c: Pick<K8sCluster, "status">) => c.status === "creating" || c.status === "provisioning" || c.status === "deleting";

/** A Kubernetes cluster's status as Incendio shows one: its icon and word. */
const K8sStatus: FC<{ status: Status }> = ({ status }) => (
  <>
    <Icon name={ICON[status]} className="status-icon" />
    {LABEL[status]}
  </>
);

export default K8sStatus;
