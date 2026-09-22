import { useState, type FC } from "react";
import { Modal } from "@canonical/react-components";
import type { UploadState } from "types/upload";
import ProgressBar from "components/ProgressBar";
import { humanFileSize } from "util/helpers";
import UploadStorageBucketBackupFileForm from "./UploadStorageBucketBackupFileForm";
import NotificationRow from "components/NotificationRow";

interface Props {
  close: () => void;
}

const UploadStorageBucketFileModal: FC<Props> = ({ close }) => {
  const [uploadState, setUploadState] = useState<UploadState | null>(null);

  return (
    <Modal
      close={close}
      className="upload-bucket-modal"
      title="Import bucket file"
      closeOnOutsideClick={false}
    >
      <NotificationRow className="u-no-padding u-no-margin" />
      {uploadState && (
        <>
          <ProgressBar percentage={Math.floor(uploadState.percentage)} />
          <p>
            {humanFileSize(uploadState.loaded)} loaded of{" "}
            {humanFileSize(uploadState.total ?? 0)}
          </p>
        </>
      )}

      <UploadStorageBucketBackupFileForm
        close={close}
        uploadState={uploadState}
        setUploadState={setUploadState}
      />
    </Modal>
  );
};

export default UploadStorageBucketFileModal;
