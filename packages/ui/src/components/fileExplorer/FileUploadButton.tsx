import { useRef, useState, type FC, type ReactNode } from "react";
import {
  ActionButton,
  Button,
  Icon,
  Input,
  Modal,
  Notification,
  usePortal,
  useToastNotification,
} from "@canonical/react-components";
import { isCancel } from "axios";
import ProgressBar from "components/ProgressBar";
import { uploadFile, type FileTarget } from "api/files";
import { humanFileSize } from "util/helpers";
import { joinPath } from "util/fileExplorer";
import type { UploadState } from "types/upload";

interface ModalProps {
  target: FileTarget;
  currentPath: string;
  /** Names already in the directory: uploading one replaces it. */
  existing: string[];
  owner: ReactNode;
  onUploaded: () => void;
  onClose: () => void;
}

const FileUploadModal: FC<ModalProps> = ({
  target,
  currentPath,
  existing,
  owner,
  onUploaded,
  onClose,
}) => {
  const toastNotify = useToastNotification();
  const [files, setFiles] = useState<File[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const controller = useRef<AbortController | null>(null);

  const replacing = files.filter((file) => existing.includes(file.name));
  const uploading = current !== null;

  const upload = async () => {
    controller.current = new AbortController();
    let done = 0;
    try {
      for (const [index, file] of files.entries()) {
        setCurrent(index);
        setProgress(null);
        await uploadFile(
          target,
          joinPath(currentPath, file.name),
          file,
          setProgress,
          controller.current.signal,
        );
        done++;
      }
      toastNotify.success(
        <>
          {files.length === 1
            ? `File ${files[0].name}`
            : `${String(files.length)} files`}{" "}
          uploaded to {owner}
        </>,
      );
      onClose();
    } catch (error) {
      if (isCancel(error)) {
        toastNotify.info(
          `Upload cancelled after ${String(done)} of ${String(files.length)} files.`,
        );
      } else {
        toastNotify.failure(
          `Uploading ${files[done]?.name ?? "files"} failed`,
          error,
        );
      }
    } finally {
      setCurrent(null);
      if (done > 0) onUploaded();
    }
  };

  const cancel = () => {
    if (uploading) controller.current?.abort();
    else onClose();
  };

  return (
    <Modal
      close={cancel}
      title="Upload files"
      buttonRow={
        <>
          <Button
            className="u-no-margin--bottom"
            onClick={cancel}
            type="button"
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={uploading}
            disabled={files.length === 0 || uploading}
            onClick={() => void upload()}
            type="button"
          >
            Upload
          </ActionButton>
        </>
      }
    >
      <p>
        To <code>{currentPath}</code>
      </p>
      <Input
        type="file"
        id="file-explorer-upload"
        label="Files"
        multiple
        disabled={uploading}
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []));
        }}
        stacked
      />
      {files.length > 0 ? (
        <ul className="p-list file-explorer-upload-list">
          {files.map((file, index) => (
            <li className="p-list__item" key={file.name}>
              <Icon
                name={
                  current !== null && index < current
                    ? "status-succeeded-small"
                    : index === current
                      ? "status-in-progress-small"
                      : "file-blank"
                }
              />{" "}
              {file.name}{" "}
              <span className="u-text--muted">
                {humanFileSize(file.size)}
                {existing.includes(file.name)
                  ? " · replaces the existing file"
                  : ""}
              </span>
              {index === current && progress ? (
                <ProgressBar percentage={progress.percentage} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {replacing.length > 0 && !uploading ? (
        <Notification severity="caution" title="Existing files">
          {replacing.length === 1
            ? `${replacing[0].name} already exists and will be overwritten.`
            : `${String(replacing.length)} files already exist and will be overwritten.`}
        </Notification>
      ) : null}
    </Modal>
  );
};

interface Props extends Omit<ModalProps, "onClose"> {
  disabledReason?: string;
}

const FileUploadButton: FC<Props> = ({ disabledReason, ...props }) => {
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
        <Icon name="upload" />
        <span>Upload</span>
      </Button>
      {isOpen && (
        <Portal>
          <FileUploadModal {...props} onClose={closePortal} />
        </Portal>
      )}
    </>
  );
};

export default FileUploadButton;
