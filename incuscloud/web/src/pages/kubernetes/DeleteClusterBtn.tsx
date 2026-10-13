import type { FC } from "react";
import { ConfirmationButton, Icon, useNotify } from "@canonical/react-components";
import { useDeleteK8sCluster } from "./useK8sClusters";

// Incendio's (pages/kubernetes/DeleteClusterBtn.tsx), by id.
interface Props {
  id: string;
  name: string;
  /** Show "Delete" next to the icon (detail page header). */
  withLabel?: boolean;
  /** Called as soon as the delete is confirmed; the teardown itself is a job. */
  onConfirmed?: () => void;
  disabled?: boolean;
}

const DeleteClusterBtn: FC<Props> = ({ id, name, withLabel, onConfirmed, disabled }) => {
  const deleteCluster = useDeleteK8sCluster();
  const notify = useNotify();
  const deleting = deleteCluster.isPending;
  return (
    <ConfirmationButton
      appearance={withLabel ? "" : "base"}
      loading={deleting}
      confirmationModalProps={{
        title: "Confirm delete",
        children: (
          <p>
            This will permanently delete cluster <strong>{name}</strong> and its nodes.
          </p>
        ),
        confirmButtonLabel: "Delete",
        onConfirm: () => {
          deleteCluster.mutate(id, { onError: (e) => notify.failure(`Deleting ${name} failed`, e) });
          onConfirmed?.();
        },
      }}
      disabled={deleting || disabled}
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
