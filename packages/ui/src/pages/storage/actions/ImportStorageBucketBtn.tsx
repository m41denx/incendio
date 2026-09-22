import type { FC } from "react";
import { Button, Icon, usePortal } from "@canonical/react-components";
import { useIsScreenBelow } from "context/useIsScreenBelow";
import { useProjectEntitlements } from "util/entitlements/projects";
import { useCurrentProject } from "context/useCurrentProject";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import UploadStorageBucketFileModal from "../forms/UploadStorageBucketFileModal";

interface Props {
  className?: string;
}

const ImportStorageBucketBtn: FC<Props> = ({ className }) => {
  const isSmallScreen = useIsScreenBelow();
  const { openPortal, closePortal, isOpen, Portal } = usePortal();
  const { canCreateStorageBuckets } = useProjectEntitlements();
  const { project } = useCurrentProject();
  const { hasStorageBucketBackup } = useSupportedFeatures();

  if (!hasStorageBucketBackup) {
    return null;
  }

  return (
    <>
      {isOpen && (
        <Portal>
          <UploadStorageBucketFileModal close={closePortal} />
        </Portal>
      )}
      <Button
        appearance="default"
        hasIcon={!isSmallScreen}
        onClick={openPortal}
        className={className}
        disabled={!canCreateStorageBuckets(project)}
        title={
          canCreateStorageBuckets(project)
            ? "Import bucket"
            : "You do not have permission to create buckets in this project"
        }
      >
        {!isSmallScreen && <Icon name="import" />}
        <span>Import bucket</span>
      </Button>
    </>
  );
};

export default ImportStorageBucketBtn;
