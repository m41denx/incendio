import type { FC } from "react";
import {
  ConfirmationButton,
  Icon,
  useToastNotification,
} from "@canonical/react-components";
import { useDeleteK8sCluster } from "pages/kubernetes/useK8sClusters";

interface Props {
  name: string;
  /** Show "Delete" next to the icon (detail page header). */
  withLabel?: boolean;
  onDeleted?: () => void;
}

const DeleteClusterBtn: FC<Props> = ({ name, withLabel, onDeleted }) => {
  const toastNotify = useToastNotification();
  const deleteCluster = useDeleteK8sCluster();
  return (
    <ConfirmationButton
      appearance={withLabel ? "" : "base"}
      loading={deleteCluster.isPending}
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
          deleteCluster.mutate(name, {
            onSuccess: () => {
              toastNotify.success(`Cluster "${name}" deleted.`);
              onDeleted?.();
            },
            onError: (error) => {
              toastNotify.failure("Cluster deletion failed", error);
            },
          });
        },
      }}
      disabled={deleteCluster.isPending}
      shiftClickEnabled
      showShiftClickHint
      title="Delete cluster"
      className="has-icon"
    >
      <Icon name="delete" />
      {withLabel ? <span>Delete</span> : null}
    </ConfirmationButton>
  );
};

export default DeleteClusterBtn;
