import type { FC } from "react";
import { ConfirmationButton, Icon } from "@canonical/react-components";
import {
  useDeleteK8sCluster,
  useDeletingClusters,
} from "pages/kubernetes/useK8sClusters";

interface Props {
  name: string;
  /** Show "Delete" next to the icon (detail page header). */
  withLabel?: boolean;
  /**
   * Called as soon as the delete is confirmed — the teardown itself takes
   * minutes; completion is reported by a toast from the delete hook.
   */
  onConfirmed?: () => void;
}

const DeleteClusterBtn: FC<Props> = ({ name, withLabel, onConfirmed }) => {
  const deleteCluster = useDeleteK8sCluster();
  const deleting = useDeletingClusters().has(name);
  return (
    <ConfirmationButton
      appearance={withLabel ? "" : "base"}
      loading={deleting}
      confirmationModalProps={{
        title: "Confirm delete",
        children: (
          <p>
            This will permanently delete cluster <strong>{name}</strong> and
            tear down its Incus project.
          </p>
        ),
        confirmButtonLabel: "Delete",
        onConfirm: () => {
          deleteCluster.mutate(name);
          onConfirmed?.();
        },
      }}
      disabled={deleting}
      shiftClickEnabled
      showShiftClickHint
      title={deleting ? "Deleting cluster" : "Delete cluster"}
      className="has-icon"
    >
      <Icon name="delete" />
      {withLabel ? <span>Delete</span> : null}
    </ConfirmationButton>
  );
};

export default DeleteClusterBtn;
