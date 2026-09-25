import type { FC } from "react";
import { Row } from "@canonical/react-components";
import { useSearchParams } from "react-router-dom";
import type { LxdStorageVolume } from "types/storage";
import { queryKeys } from "util/queryKeys";
import { getVolumeDetailUrl } from "util/storageVolume";
import { useStorageVolumeEntitlements } from "util/entitlements/storage-volumes";
import { volumeFileTarget } from "api/files";
import FileExplorer from "components/fileExplorer/FileExplorer";
import VolumeLinkChip from "pages/storage/VolumeLinkChip";

interface Props {
  volume: LxdStorageVolume;
}

// Files of a custom filesystem volume (`file_storage_volume`). Incus mounts
// the volume on its host and serves it over SFTP, so this works whether or
// not the volume is attached to an instance.
const StorageVolumeFiles: FC<Props> = ({ volume }) => {
  const [searchParams] = useSearchParams();
  const currentPath = searchParams.get("path") || "/";
  const { canEditVolume } = useStorageVolumeEntitlements();

  const directoryLink = (path: string) =>
    `${getVolumeDetailUrl(volume)}/files?${new URLSearchParams({ path }).toString()}`;

  return (
    <Row className="general">
      <FileExplorer
        target={volumeFileTarget(volume)}
        queryKey={[
          queryKeys.storage,
          volume.pool,
          volume.project,
          volume.location,
          volume.name,
          queryKeys.files,
        ]}
        currentPath={currentPath}
        directoryLink={directoryLink}
        owner={<VolumeLinkChip volume={volume} />}
        writeDisabledReason={
          canEditVolume(volume)
            ? undefined
            : "You do not have permission to change files on this volume"
        }
      />
    </Row>
  );
};

export default StorageVolumeFiles;
