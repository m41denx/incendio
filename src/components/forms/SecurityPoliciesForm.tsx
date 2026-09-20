import type { FC } from "react";
import { Button, Input, Select } from "@canonical/react-components";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";
import classnames from "classnames";
import { optionAllowDeny, optionTrueFalse, optionYesNo } from "util/options";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";

import {
  getConfigurationRow,
  getConfigurationRowBase,
} from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";
import AutoExpandingTextArea from "components/AutoExpandingTextArea";
import { optionRenderer } from "util/formFields";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { BOOT } from "pages/instances/forms/InstanceFormMenu";

interface Props {
  formik: InstanceAndProfileFormikProps;
  setSection: (section: string) => void;
}

const SecurityPoliciesForm: FC<Props> = ({ formik, setSection }) => {
  const { hasInstanceBootMode } = useSupportedFeatures();
  const isInstance = formik.values.entityType === "instance";
  const isContainerOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !== "container";
  const isVmOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !==
      "virtual-machine";

  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "Protect deletion",
          name: "security_protection_delete",
          defaultValue: "",
          readOnlyRenderer: (val) => optionRenderer(val, optionYesNo),
          children: <Select options={optionYesNo} />,
        }),

        getConfigurationRow({
          formik,
          label: "Protect starting",
          name: "security_protection_start",
          defaultValue: "",
          readOnlyRenderer: (val) => optionRenderer(val, optionYesNo),
          children: <Select options={optionYesNo} />,
        }),

        getConfigurationRow({
          formik,
          label: "Privileged (Containers only)",
          name: "security_privileged",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionAllowDeny),
          children: (
            <Select
              options={optionAllowDeny}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Nesting (Containers only)",
          name: "security_nesting",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionAllowDeny),
          children: (
            <Select
              options={optionAllowDeny}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Protect UID/GID shift (Containers only)",
          name: "security_protection_shift",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionYesNo),
          children: (
            <Select options={optionYesNo} disabled={isContainerOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Base host id (Containers only)",
          name: "security_idmap_base",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              placeholder="Enter ID"
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Idmap size (Containers only)",
          name: "security_idmap_size",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              placeholder="Enter number"
              type="number"
              min={0}
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Unique idmap (Containers only)",
          name: "security_idmap_isolated",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionYesNo),
          children: (
            <Select options={optionYesNo} disabled={isContainerOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Allow /dev/incus in the instance",
          name: "security_devlxd",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionYesNo),
          children: (
            <Select options={optionYesNo} disabled={isContainerOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label:
            "Make /1.0/images API available over /dev/incus (Containers only)",
          name: "security_devlxd_images",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionYesNo),
          children: (
            <Select options={optionYesNo} disabled={isContainerOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Enable virtual IOMMU (VMs only)",
          name: "security_iommu",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select options={optionTrueFalse} disabled={isVmOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Enable AMD SEV memory encryption (VMs only)",
          name: "security_sev",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select options={optionTrueFalse} disabled={isVmOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Enable AMD SEV-ES (VMs only)",
          name: "security_sev_policy_es",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select options={optionTrueFalse} disabled={isVmOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Expose metrics through the agent (VMs only)",
          name: "security_agent_metrics",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select options={optionTrueFalse} disabled={isVmOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Use the agent to configure NICs (VMs only)",
          name: "agent_nic_config",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select options={optionTrueFalse} disabled={isVmOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "SELinux process domain",
          name: "security_selinux_domain",
          defaultValue: "",
          children: <Input type="text" />,
        }),

        getConfigurationRow({
          formik,
          label: "SELinux MCS level",
          name: "security_selinux_level",
          defaultValue: "",
          children: <Input type="text" />,
        }),

        getConfigurationRow({
          formik,
          label: "SELinux file type",
          name: "security_selinux_type",
          defaultValue: "",
          children: <Input type="text" />,
        }),

        getConfigurationRow({
          formik,
          label: "SELinux rootfs labeling mode (Containers only)",
          name: "security_selinux_label_rootfs",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "BPF attach types to delegate (Containers only)",
          name: "security_bpffs_delegate_attachs",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "BPF command types to delegate (Containers only)",
          name: "security_bpffs_delegate_cmds",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "BPF map types to delegate (Containers only)",
          name: "security_bpffs_delegate_maps",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "BPF program types to delegate (Containers only)",
          name: "security_bpffs_delegate_progs",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "BPF file system mount path (Containers only)",
          name: "security_bpffs_path",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "SEV session blob (VMs only)",
          name: "security_sev_session_data",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isVmOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isVmOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "SEV Diffie-Hellman key (VMs only)",
          name: "security_sev_session_dh",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isVmOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isVmOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Allowed syscalls (Containers only)",
          name: "security_syscalls_allow",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <AutoExpandingTextArea disabled={isContainerOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Denied syscalls (Containers only)",
          name: "security_syscalls_deny",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <AutoExpandingTextArea disabled={isContainerOnlyDisabled} />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Block compat_* syscalls (Containers only)",
          name: "security_syscalls_deny_compat",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Enable default syscall deny (Containers only)",
          name: "security_syscalls_deny_default",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Intercept bpf() syscall (Containers only)",
          name: "security_syscalls_intercept_bpf",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Allow BPF programs (Containers only)",
          name: "security_syscalls_intercept_bpf_devices",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Intercept mknod/mknodat syscalls (Containers only)",
          name: "security_syscalls_intercept_mknod",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Intercept mount syscall (Containers only)",
          name: "security_syscalls_intercept_mount",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "File systems that can be mounted (Containers only)",
          name: "security_syscalls_intercept_mount_allowed",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "File systems redirected to FUSE (Containers only)",
          name: "security_syscalls_intercept_mount_fuse",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Use idmapped mounts for interception (Containers only)",
          name: "security_syscalls_intercept_mount_shift",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Intercept sched_setscheduler syscall (Containers only)",
          name: "security_syscalls_intercept_sched_setscheduler",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Intercept setxattr syscall (Containers only)",
          name: "security_syscalls_intercept_setxattr",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          label: "Intercept sysinfo syscall (Containers only)",
          name: "security_syscalls_intercept_sysinfo",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
          children: (
            <Select
              options={optionTrueFalse}
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        ...(hasInstanceBootMode
          ? [
              getConfigurationRowBase({
                className: "u-text--muted",
                configuration: (
                  <>
                    <b>Enable secureboot (VMs only)</b> and{" "}
                    <b>Enable CSM (VMs only)</b>
                  </>
                ),
                inherited: "",
                override: (
                  <Button
                    appearance="link"
                    type="button"
                    onClick={() => {
                      setSection(BOOT);
                    }}
                  >
                    See boot mode
                  </Button>
                ),
              }),
            ]
          : [
              getConfigurationRow({
                formik,
                label: "Enable secureboot (VMs only)",
                name: "security_secureboot",
                defaultValue: "",
                disabled: isVmOnlyDisabled,
                disabledReason: isVmOnlyDisabled
                  ? "Only available for virtual machines"
                  : undefined,
                readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
                children: (
                  <Select
                    options={optionTrueFalse}
                    disabled={isVmOnlyDisabled}
                  />
                ),
              }),

              getConfigurationRow({
                formik,
                label: "Enable CSM (VMs only)",
                name: "security_csm",
                defaultValue: "",
                disabled: isVmOnlyDisabled,
                disabledReason: isVmOnlyDisabled
                  ? "Only available for virtual machines"
                  : undefined,
                readOnlyRenderer: (val) => optionRenderer(val, optionTrueFalse),
                children: (
                  <Select
                    options={optionTrueFalse}
                    disabled={isVmOnlyDisabled}
                  />
                ),
              }),
            ]),
      ]}
    />
  );
};

export default SecurityPoliciesForm;
