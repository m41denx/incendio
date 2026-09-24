import type { FC } from "react";
import { Icon } from "@canonical/react-components";

const STATUS_ICON: Record<string, string> = {
  ready: "status-succeeded-small",
  provisioning: "status-in-progress-small",
  scaling: "status-in-progress-small",
  upgrading: "status-in-progress-small",
  pending: "status-waiting-small",
  error: "status-failed-small",
  deleting: "status-in-progress-small",
};

const capitalize = (value: string): string =>
  value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;

interface Props {
  status: string;
}

const ClusterStatusLabel: FC<Props> = ({ status }) => (
  <>
    <Icon
      name={STATUS_ICON[status] ?? "status-waiting-small"}
      className="status-icon"
    />
    {capitalize(status)}
  </>
);

export default ClusterStatusLabel;
