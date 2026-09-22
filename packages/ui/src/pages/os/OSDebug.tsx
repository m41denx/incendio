import type { FC } from "react";
import { runOSAction } from "api/os";
import TabLinks from "components/TabLinks";
import OSConfigSection from "pages/os/OSConfigSection";
import OSActionButton from "pages/os/actions/OSActionButton";
import OSDebugLog from "pages/os/OSDebugLog";
import OSDebugProcesses from "pages/os/OSDebugProcesses";
import { slugify } from "util/slugify";

const tabs = ["Log", "Processes", "Secure Boot"];

interface ActionsProps {
  target: string;
}

const SecureBootActions: FC<ActionsProps> = ({ target }) => (
  <OSActionButton
    label="Update keys"
    mode="confirm"
    confirmMessage="Update the secure boot keys?"
    run={async () => runOSAction("debug/secureboot", "update", target)}
    successMessage="Secure boot keys update triggered"
  />
);

interface Props {
  subTab?: string;
  target: string;
}

const OSDebug: FC<Props> = ({ subTab, target }) => {
  return (
    <>
      <TabLinks tabs={tabs} activeTab={subTab} tabUrl={`/ui/os/debug`} />
      {(!subTab || subTab === slugify("Log")) && <OSDebugLog target={target} />}
      {subTab === slugify("Processes") && <OSDebugProcesses target={target} />}
      {subTab === slugify("Secure Boot") && (
        <OSConfigSection
          endpoint="debug/secureboot/event-log"
          label="Secure boot event log"
          target={target}
          readOnly
          actions={<SecureBootActions target={target} />}
        />
      )}
    </>
  );
};

export default OSDebug;
