import type { FC } from "react";
import classnames from "classnames";
import { List } from "@canonical/react-components";
import { runOSAction, runOSActionDownload, runOSActionUpload } from "api/os";
import OSActionButton from "pages/os/actions/OSActionButton";
import RebootOSBtn from "pages/os/actions/RebootOSBtn";
import ShutdownOSBtn from "pages/os/actions/ShutdownOSBtn";

interface Props {
  className?: string;
  target: string;
}

const OSActions: FC<Props> = ({ className, target }) => {
  const items = [
    <RebootOSBtn target={target} key="reboot" />,
    <OSActionButton
      key="suspend"
      label="Suspend"
      mode="confirm"
      icon="pause"
      confirmMessage="Are you sure you want to suspend the system?"
      run={async () => runOSAction("system", "suspend", target)}
      successMessage="System suspended"
    />,
    <ShutdownOSBtn target={target} key="shutdown" />,
    <OSActionButton
      key="backup"
      label="Backup"
      mode="download"
      icon="begin-downloading"
      filename="incus-os-backup"
      run={async () => runOSActionDownload("system", "backup", target, {})}
      successMessage="System backup downloaded"
    />,
    <OSActionButton
      key="restore"
      label="Restore"
      mode="upload"
      icon="upload"
      run={async (input) =>
        runOSActionUpload("system", "restore", input as File, target)
      }
      successMessage="System restore triggered"
    />,
    <OSActionButton
      key="factory-reset"
      label="Factory reset"
      mode="confirm"
      icon="settings"
      destructive
      confirmMessage="This will factory-reset the system. Are you sure?"
      run={async () => runOSAction("system", "factory-reset", target, {})}
      successMessage="Factory reset triggered"
    />,
  ];

  return (
    <List
      inline
      className={classnames(className, "actions-list")}
      items={items}
    />
  );
};

export default OSActions;
