import type { FC } from "react";
import { Input } from "@canonical/react-components";
import classnames from "classnames";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import { getConfigurationRow } from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";
import AutoExpandingTextArea from "components/AutoExpandingTextArea";
import ScriptletConfigInput from "components/forms/ScriptletConfigInput";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import type { MainTableRow } from "@canonical/react-components/dist/components/MainTable/MainTable";
export { rawConfigPayload } from "util/instanceAndProfilePayloads";

interface Props {
  formik: InstanceAndProfileFormikProps;
}

const RawConfigForm: FC<Props> = ({ formik }) => {
  const { hasQemuScriptlet, hasQemuRawQmp, hasQemuRawConf } =
    useSupportedFeatures();
  const isInstance = formik.values.entityType === "instance";
  const isContainerOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !== "container";
  const isVmOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !==
      "virtual-machine";

  const textAreaRow = (name: string, label: string, disabled: boolean) =>
    getConfigurationRow({
      formik,
      label,
      name,
      defaultValue: "",
      disabled,
      disabledReason: disabled
        ? "Only available for this instance type"
        : undefined,
      children: <AutoExpandingTextArea disabled={disabled} />,
    });

  const rows: MainTableRow[] = [
    textAreaRow(
      "raw_lxc",
      "Raw LXC (Containers only)",
      isContainerOnlyDisabled,
    ),
    textAreaRow(
      "raw_seccomp",
      "Raw seccomp (Containers only)",
      isContainerOnlyDisabled,
    ),
    textAreaRow(
      "raw_idmap",
      "Raw idmap (Containers only)",
      isContainerOnlyDisabled,
    ),
    textAreaRow("raw_apparmor", "Raw AppArmor", false),
    textAreaRow("raw_qemu", "Raw QEMU (VMs only)", isVmOnlyDisabled),
  ];

  if (hasQemuRawConf) {
    rows.push(
      textAreaRow(
        "raw_qemu_conf",
        "Raw QEMU configuration (VMs only)",
        isVmOnlyDisabled,
      ),
    );
  }

  if (hasQemuScriptlet) {
    rows.push(
      getConfigurationRow({
        formik,
        label: "Raw QEMU scriptlet (VMs only)",
        name: "raw_qemu_scriptlet",
        defaultValue: "",
        disabled: isVmOnlyDisabled,
        disabledReason: isVmOnlyDisabled
          ? "Only available for virtual machines"
          : undefined,
        children: <ScriptletConfigInput disabled={isVmOnlyDisabled} />,
      }),
    );
  }

  if (hasQemuRawQmp) {
    rows.push(
      textAreaRow(
        "raw_qemu_qmp_early",
        "Raw QEMU QMP early commands (VMs only)",
        isVmOnlyDisabled,
      ),
      textAreaRow(
        "raw_qemu_qmp_pre_start",
        "Raw QEMU QMP pre-start commands (VMs only)",
        isVmOnlyDisabled,
      ),
      textAreaRow(
        "raw_qemu_qmp_post_start",
        "Raw QEMU QMP post-start commands (VMs only)",
        isVmOnlyDisabled,
      ),
    );
  }

  rows.push(
    getConfigurationRow({
      formik,
      label: "Kernel modules to load (Containers only)",
      name: "linux_kernel_modules",
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
  );

  return <ScrollableConfigurationTable rows={rows} />;
};

export default RawConfigForm;
