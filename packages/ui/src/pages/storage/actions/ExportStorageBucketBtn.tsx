import type { FC } from "react";
import { Button, Icon, usePortal } from "@canonical/react-components";
import classnames from "classnames";
import type { LxdStorageBucket } from "types/storage";
import ExportStorageBucketModal from "../forms/ExportStorageBucketModal";
import { useStorageBucketEntitlements } from "util/entitlements/storage-buckets";
import { useCurrentProject } from "context/useCurrentProject";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { isBackupDisabled } from "util/snapshots";

interface Props {
  bucket: LxdStorageBucket;
  classname?: string;
  isDetailPage?: boolean;
  onClose?: () => void;
}

const ExportStorageBucketBtn: FC<Props> = ({
  bucket,
  classname,
  isDetailPage,
  onClose,
}) => {
  const { openPortal, closePortal, isOpen, Portal } = usePortal();
  const { canEditBucket } = useStorageBucketEntitlements();
  const { project } = useCurrentProject();
  const { hasStorageBucketBackup } = useSupportedFeatures();
  const backupDisabled = isBackupDisabled(project);

  if (!hasStorageBucketBackup) {
    return null;
  }

  const handleClose = () => {
    closePortal();
    onClose?.();
  };

  const getTitle = () => {
    if (!canEditBucket(bucket)) {
      return "You do not have permission to export this bucket.";
    }
    if (backupDisabled) {
      return `Project "${project?.name}" doesn't allow for backup creation.`;
    }
    return "Export bucket";
  };

  return (
    <>
      {isOpen && (
        <Portal>
          <ExportStorageBucketModal
            bucket={bucket}
            project={project?.name ?? ""}
            close={handleClose}
          />
        </Portal>
      )}
      <Button
        key={`${bucket.name}-export`}
        appearance={isDetailPage ? "default" : "base"}
        className={classnames(classname, "has-icon")}
        onClick={openPortal}
        title={getTitle()}
        disabled={!canEditBucket(bucket) || backupDisabled}
      >
        <Icon name="export" />
        {isDetailPage && <span>Export</span>}
      </Button>
    </>
  );
};

export default ExportStorageBucketBtn;
