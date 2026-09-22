import type { FC } from "react";
import { Button, Icon, usePortal } from "@canonical/react-components";
import type { LxdInstance } from "types/instance";
import MigrateInstanceBulkModal from "../MigrateInstanceBulkModal";

interface Props {
  instances: LxdInstance[];
  onStart: (names: string[]) => void;
  onFinish: () => void;
}

const MigrateInstanceBulkBtn: FC<Props> = ({
  instances,
  onStart,
  onFinish,
}) => {
  const { openPortal, closePortal, isOpen, Portal } = usePortal();

  return (
    <>
      {isOpen && (
        <Portal>
          <MigrateInstanceBulkModal
            close={closePortal}
            instances={instances}
            onStart={onStart}
            onFinish={onFinish}
          />
        </Portal>
      )}
      <div className="p-segmented-control bulk-actions">
        <div className="p-segmented-control__list bulk-action-frame">
          <Button
            appearance="base"
            hasIcon
            className="u-no-margin--bottom"
            onClick={openPortal}
            type="button"
          >
            <Icon name="machines" />
            <span>Migrate</span>
          </Button>
        </div>
      </div>
    </>
  );
};

export default MigrateInstanceBulkBtn;
