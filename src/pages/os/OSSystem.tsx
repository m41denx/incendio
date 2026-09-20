import type { FC, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOSSection, runOSAction } from "api/os";
import TabLinks from "components/TabLinks";
import OSConfigSection from "pages/os/OSConfigSection";
import OSActionButton, {
  type OSActionInput,
  type OSActionValues,
} from "pages/os/actions/OSActionButton";
import type { IncusOSNetworkState } from "types/os";
import { queryKeys } from "util/queryKeys";
import { slugify } from "util/slugify";

const vals = (input: OSActionInput) => input as OSActionValues;
const str = (v: OSActionValues, k: string) => String(v[k] ?? "");
const num = (v: OSActionValues, k: string) => Number(v[k] ?? 0);
const bool = (v: OSActionValues, k: string) => Boolean(v[k]);

interface ActionsProps {
  target: string;
}

const NetworkActions: FC<ActionsProps> = ({ target }) => {
  const { data } = useQuery({
    queryKey: [queryKeys.osSection, "system/network", target],
    queryFn: async () => fetchOSSection("system/network", target),
  });

  const pendingChange =
    (data?.state as IncusOSNetworkState | undefined)
      ?.configuration_in_process ?? false;

  return (
    <>
      {pendingChange && (
        <OSActionButton
          label="Confirm configuration"
          mode="confirm"
          confirmMessage="Confirm the new network configuration?"
          run={async () => runOSAction("system/network", "confirm", target)}
          successMessage="Network configuration confirmed"
          invalidateKeys={[[queryKeys.osSection, "system/network", target]]}
        />
      )}
      <OSActionButton
        label="Flush DNS cache"
        mode="confirm"
        confirmMessage="Flush the DNS cache?"
        run={async () => runOSAction("system/network", "flush-dns", target)}
        successMessage="DNS cache flushed"
      />
    </>
  );
};

const StorageActions: FC<ActionsProps> = ({ target }) => {
  const invalidate = [[queryKeys.osSection, "system/storage", target]];

  return (
    <>
      <OSActionButton
        label="Create volume"
        mode="fields"
        submitLabel="Create"
        fields={[
          { name: "pool", label: "Pool" },
          { name: "name", label: "Name" },
          { name: "quota", label: "Quota (bytes)", type: "number" },
          { name: "use", label: "Use" },
        ]}
        run={async (input) =>
          runOSAction("system/storage", "create-volume", target, {
            pool: str(vals(input), "pool"),
            name: str(vals(input), "name"),
            quota: num(vals(input), "quota"),
            use: str(vals(input), "use"),
          })
        }
        successMessage="Volume created"
        invalidateKeys={invalidate}
      />
      <OSActionButton
        label="Delete volume"
        mode="fields"
        submitLabel="Delete"
        destructive
        confirmMessage="This will delete the storage volume."
        fields={[
          { name: "pool", label: "Pool" },
          { name: "name", label: "Name" },
          { name: "force", label: "Force", type: "checkbox" },
        ]}
        run={async (input) =>
          runOSAction("system/storage", "delete-volume", target, {
            pool: str(vals(input), "pool"),
            name: str(vals(input), "name"),
            force: bool(vals(input), "force"),
          })
        }
        successMessage="Volume deleted"
        invalidateKeys={invalidate}
      />
      <OSActionButton
        label="Delete pool"
        mode="fields"
        submitLabel="Delete"
        destructive
        confirmMessage="This will delete the storage pool."
        fields={[{ name: "name", label: "Name" }]}
        run={async (input) =>
          runOSAction("system/storage", "delete-pool", target, {
            name: str(vals(input), "name"),
          })
        }
        successMessage="Pool deleted"
        invalidateKeys={invalidate}
      />
      <OSActionButton
        label="Scrub pool"
        mode="fields"
        submitLabel="Scrub"
        fields={[{ name: "name", label: "Name" }]}
        run={async (input) =>
          runOSAction("system/storage", "scrub-pool", target, {
            name: str(vals(input), "name"),
          })
        }
        successMessage="Pool scrub triggered"
      />
      <OSActionButton
        label="Encrypt drive"
        mode="fields"
        submitLabel="Encrypt"
        destructive
        confirmMessage="This will wipe and encrypt the drive."
        fields={[
          { name: "id", label: "Drive ID" },
          { name: "secure_wipe", label: "Secure wipe", type: "checkbox" },
        ]}
        run={async (input) =>
          runOSAction("system/storage", "encrypt-drive", target, {
            id: str(vals(input), "id"),
            secure_wipe: bool(vals(input), "secure_wipe"),
          })
        }
        successMessage="Drive encryption triggered"
        invalidateKeys={invalidate}
      />
      <OSActionButton
        label="Wipe drive"
        mode="fields"
        submitLabel="Wipe"
        destructive
        confirmMessage="This will wipe the drive."
        fields={[
          { name: "id", label: "Drive ID" },
          { name: "secure_wipe", label: "Secure wipe", type: "checkbox" },
        ]}
        run={async (input) =>
          runOSAction("system/storage", "wipe-drive", target, {
            id: str(vals(input), "id"),
            secure_wipe: bool(vals(input), "secure_wipe"),
          })
        }
        successMessage="Drive wipe triggered"
        invalidateKeys={invalidate}
      />
      <OSActionButton
        label="Import encrypted drive"
        mode="fields"
        submitLabel="Import"
        fields={[
          { name: "id", label: "Drive ID" },
          { name: "key", label: "Encryption key" },
        ]}
        run={async (input) =>
          runOSAction("system/storage", "import-encrypted-drive", target, {
            id: str(vals(input), "id"),
            key: str(vals(input), "key"),
          })
        }
        successMessage="Drive imported"
        invalidateKeys={invalidate}
      />
      <OSActionButton
        label="Import pool"
        mode="fields"
        submitLabel="Import"
        fields={[
          { name: "name", label: "Name" },
          { name: "encryption_key", label: "Encryption key" },
        ]}
        run={async (input) =>
          runOSAction("system/storage", "import-pool", target, {
            name: str(vals(input), "name"),
            type: "zfs",
            encryption_key: str(vals(input), "encryption_key"),
          })
        }
        successMessage="Pool imported"
        invalidateKeys={invalidate}
      />
    </>
  );
};

const SecurityActions: FC<ActionsProps> = ({ target }) => (
  <OSActionButton
    label="Rebind TPM"
    mode="confirm"
    confirmMessage="Rebind the TPM and reboot the system?"
    run={async () => runOSAction("system/security", "tpm-rebind", target)}
    successMessage="TPM rebind triggered"
  />
);

const UpdateActions: FC<ActionsProps> = ({ target }) => (
  <OSActionButton
    label="Check for updates"
    mode="confirm"
    confirmMessage="Check for updates and apply any pending update?"
    run={async () => runOSAction("system/update", "check", target, {})}
    successMessage="Update check triggered"
  />
);

interface Section {
  label: string;
  endpoint: string;
  readOnly?: boolean;
  actions?: (target: string) => ReactNode;
}

const sections: Section[] = [
  {
    label: "Network",
    endpoint: "system/network",
    actions: (target: string) => <NetworkActions target={target} />,
  },
  {
    label: "Storage",
    endpoint: "system/storage",
    actions: (target: string) => <StorageActions target={target} />,
  },
  {
    label: "Security",
    endpoint: "system/security",
    actions: (target: string) => <SecurityActions target={target} />,
  },
  {
    label: "Update",
    endpoint: "system/update",
    actions: (target: string) => <UpdateActions target={target} />,
  },
  { label: "Kernel", endpoint: "system/kernel" },
  { label: "Logging", endpoint: "system/logging" },
  { label: "Provider", endpoint: "system/provider" },
  { label: "Fallback listener", endpoint: "system/fallback-listener" },
  { label: "Resources", endpoint: "system/resources", readOnly: true },
].sort((a, b) => a.label.localeCompare(b.label));

interface Props {
  subTab?: string;
  target: string;
}

const OSSystem: FC<Props> = ({ subTab, target }) => {
  const tabs = sections.map((section) => section.label);
  const active =
    sections.find((section) => slugify(section.label) === subTab) ??
    sections[0];

  return (
    <>
      <TabLinks tabs={tabs} activeTab={subTab} tabUrl={`/ui/os/system`} />
      <OSConfigSection
        key={active.endpoint}
        endpoint={active.endpoint}
        label={active.label}
        target={target}
        readOnly={active.readOnly}
        actions={active.actions ? active.actions(target) : undefined}
      />
    </>
  );
};

export default OSSystem;
