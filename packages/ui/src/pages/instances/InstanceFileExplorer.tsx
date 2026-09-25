import { type FC } from "react";
import { EmptyState, Icon, Row } from "@canonical/react-components";
import { useSearchParams } from "react-router-dom";
import type { LxdInstance } from "types/instance";
import { isInstanceRunning } from "util/instanceStatus";
import { queryKeys } from "util/queryKeys";
import { useInstanceEntitlements } from "util/entitlements/instances";
import { getFileExplorerDirectoryURL } from "util/instances";
import { instanceFileTarget } from "api/files";
import FileExplorer from "components/fileExplorer/FileExplorer";
import { InstanceRichChip } from "./InstanceRichChip";
import StartInstanceBtn from "./actions/StartInstanceBtn";

interface Props {
  instance: LxdInstance;
}

const InstanceFileExplorer: FC<Props> = ({ instance }) => {
  const [searchParams] = useSearchParams();
  const currentPath = searchParams.get("path") || "/";
  const { canAccessInstanceFiles } = useInstanceEntitlements();
  const canServeFiles =
    isInstanceRunning(instance) || instance.type === "container";

  if (!canServeFiles) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="containers" className="empty-state-icon" />}
        title="Instance is not running"
      >
        <p>Virtual machines must be running to browse files.</p>
        <StartInstanceBtn
          instance={instance}
          appearance="positive"
          dense={false}
          iconClassname="is-light"
          hasLabel
          showBooting
        />
      </EmptyState>
    );
  }

  return (
    <Row className="general">
      <FileExplorer
        target={instanceFileTarget(instance)}
        queryKey={[
          queryKeys.instances,
          instance.name,
          instance.project,
          queryKeys.files,
        ]}
        currentPath={currentPath}
        directoryLink={(path) => getFileExplorerDirectoryURL(path, instance)}
        owner={
          <InstanceRichChip
            instanceName={instance.name}
            projectName={instance.project}
          />
        }
        writeDisabledReason={
          canAccessInstanceFiles(instance)
            ? undefined
            : "You do not have permission to manage files on this instance"
        }
      />
    </Row>
  );
};

export default InstanceFileExplorer;
