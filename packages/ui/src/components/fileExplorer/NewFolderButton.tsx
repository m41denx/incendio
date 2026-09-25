import { useState, type FC, type ReactNode } from "react";
import {
  ActionButton,
  Button,
  Icon,
  Input,
  Modal,
  usePortal,
  useToastNotification,
} from "@canonical/react-components";
import { createDirectory, type FileTarget } from "api/files";
import { joinPath, newEntryNameError } from "util/fileExplorer";

interface ModalProps {
  target: FileTarget;
  currentPath: string;
  existing: string[];
  owner: ReactNode;
  onCreated: () => void;
  onClose: () => void;
}

const NewFolderModal: FC<ModalProps> = ({
  target,
  currentPath,
  existing,
  owner,
  onCreated,
  onClose,
}) => {
  const toastNotify = useToastNotification();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = newEntryNameError(name, existing);

  const submit = () => {
    if (error) {
      setTouched(true);
      return;
    }
    setSaving(true);
    const folder = name.trim();
    createDirectory(target, joinPath(currentPath, folder))
      .then(() => {
        toastNotify.success(
          <>
            Directory {folder} created in {owner}
          </>,
        );
        onCreated();
        onClose();
      })
      .catch((e) => {
        toastNotify.failure(`Creating directory ${folder} failed`, e);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <Modal
      close={onClose}
      title="New folder"
      buttonRow={
        <>
          <Button
            className="u-no-margin--bottom"
            onClick={onClose}
            type="button"
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={saving}
            disabled={saving || error !== null}
            onClick={submit}
            type="button"
          >
            Create
          </ActionButton>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          id="file-explorer-new-folder"
          type="text"
          label="Name"
          help={
            <>
              Created in <code>{currentPath}</code>
            </>
          }
          value={name}
          autoFocus
          error={touched ? error : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            setTouched(true);
          }}
        />
      </form>
    </Modal>
  );
};

interface Props extends Omit<ModalProps, "onClose"> {
  disabledReason?: string;
}

const NewFolderButton: FC<Props> = ({ disabledReason, ...props }) => {
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  return (
    <>
      <Button
        hasIcon
        onClick={openPortal}
        disabled={disabledReason !== undefined}
        title={disabledReason}
      >
        <Icon name="folder" />
        <span>New folder</span>
      </Button>
      {isOpen && (
        <Portal>
          <NewFolderModal {...props} onClose={closePortal} />
        </Portal>
      )}
    </>
  );
};

export default NewFolderButton;
