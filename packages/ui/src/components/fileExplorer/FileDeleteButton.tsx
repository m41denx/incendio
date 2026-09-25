import { useState, type FC, type ReactNode } from "react";
import {
  ConfirmationButton,
  Icon,
  useToastNotification,
} from "@canonical/react-components";
import { deleteFile, type FileTarget } from "api/files";
import { baseName } from "util/fileExplorer";

interface Props {
  target: FileTarget;
  path: string;
  isDirectory: boolean;
  /** Rich chip of the instance or volume, for the toast. */
  owner: ReactNode;
  disabledReason?: string;
  onDeleted: () => void;
}

const FileDeleteButton: FC<Props> = ({
  target,
  path,
  isDirectory,
  owner,
  disabledReason,
  onDeleted,
}) => {
  const [isLoading, setLoading] = useState(false);
  const toastNotify = useToastNotification();
  const name = baseName(path);
  const kind = isDirectory ? "directory" : "file";

  const handleDelete = () => {
    setLoading(true);
    deleteFile(target, path, isDirectory)
      .then(() => {
        toastNotify.success(
          <>
            {isDirectory ? "Directory" : "File"} {name} deleted from {owner}
          </>,
        );
        onDeleted();
      })
      .catch((e) => {
        toastNotify.failure(`Deletion failed for ${kind} ${name}`, e);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <ConfirmationButton
      appearance="base"
      className="has-icon is-dense u-no-margin--bottom"
      loading={isLoading}
      onHoverText={disabledReason ?? `Delete ${kind} ${name}`}
      confirmationModalProps={{
        title: "Confirm delete",
        children: (
          <p>
            This will permanently delete {kind} <b>{name}</b>
            {isDirectory ? " and everything in it" : ""}.
            <br />
            This action cannot be undone, and can result in data loss.
          </p>
        ),
        confirmButtonLabel: "Delete",
        onConfirm: handleDelete,
      }}
      disabled={isLoading || disabledReason !== undefined}
      shiftClickEnabled
      showShiftClickHint
    >
      <Icon name="delete" />
    </ConfirmationButton>
  );
};

export default FileDeleteButton;
