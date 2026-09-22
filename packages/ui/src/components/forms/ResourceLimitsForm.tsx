import type { FC } from "react";
import { Input, Select } from "@canonical/react-components";
import classnames from "classnames";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";
import MemoryLimitSelector from "./MemoryLimitSelector";
import CpuLimitSelector from "./CpuLimitSelector";
import type { CpuLimit, MemoryLimit } from "types/limits";
import {
  cpuLimitToPayload,
  memoryLimitToPayload,
} from "util/instanceAndProfilePayloads";
import { optionAllowDeny, optionTrueFalse } from "util/options";
import { diskPriorities } from "util/instanceOptions";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import { DEFAULT_CPU_LIMIT, DEFAULT_MEM_LIMIT } from "util/defaults";
import { getConfigurationRow } from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";
import { optionRenderer } from "util/formFields";

interface Props {
  formik: InstanceAndProfileFormikProps;
}

const ResourceLimitsForm: FC<Props> = ({ formik }) => {
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
          name: "limits_cpu",
          label: "Exposed CPU limit",
          defaultValue: DEFAULT_CPU_LIMIT,
          readOnlyRenderer: (val) =>
            cpuLimitToPayload(val as CpuLimit | string | undefined),
          children: (
            <CpuLimitSelector
              formik={formik}
              cpuLimit={formik.values.limits_cpu}
              setCpuLimit={(cpuLimit) => {
                formik.setFieldValue("limits_cpu", cpuLimit);
              }}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          name: "limits_memory",
          label: "Memory limit",
          defaultValue: DEFAULT_MEM_LIMIT,
          readOnlyRenderer: (val) =>
            memoryLimitToPayload(val as MemoryLimit | undefined) ?? "",
          children: (
            <MemoryLimitSelector
              formik={formik}
              memoryLimit={formik.values.limits_memory}
              setMemoryLimit={(memoryLimit) =>
                void formik.setFieldValue("limits_memory", memoryLimit)
              }
            />
          ),
        }),

        getConfigurationRow({
          formik,
          name: "limits_memory_swap",
          label: "Memory swap (Containers only)",
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
          name: "limits_disk_priority",
          label: "Disk priority",
          defaultValue: "",
          children: <Select options={diskPriorities} />,
        }),

        getConfigurationRow({
          formik,
          name: "limits_processes",
          label: "Max number of processes (Containers only)",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              placeholder="Enter number"
              min={1}
              type="number"
              disabled={isContainerOnlyDisabled}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          name: "limits_cpu_allowance",
          label: "CPU allowance (Containers only)",
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
          name: "limits_cpu_nodes",
          label: "CPU NUMA nodes",
          defaultValue: "",
          children: <Input type="text" />,
        }),

        getConfigurationRow({
          formik,
          name: "limits_cpu_priority",
          label: "CPU priority (Containers only)",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
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
          name: "limits_hugepages_64KB",
          label: "64 KB huge pages limit (Containers only)",
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
          name: "limits_hugepages_1MB",
          label: "1 MB huge pages limit (Containers only)",
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
          name: "limits_hugepages_2MB",
          label: "2 MB huge pages limit (Containers only)",
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
          name: "limits_hugepages_1GB",
          label: "1 GB huge pages limit (Containers only)",
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
          name: "limits_memory_enforce",
          label: "Memory enforcement (Containers only)",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
              type="text"
              placeholder="hard or soft"
              disabled={isContainerOnlyDisabled}
              labelClassName={classnames({
                "is-disabled": isContainerOnlyDisabled,
              })}
            />
          ),
        }),

        getConfigurationRow({
          formik,
          name: "limits_memory_swap_priority",
          label: "Swap priority (Containers only)",
          defaultValue: "",
          disabled: isContainerOnlyDisabled,
          disabledReason: isContainerOnlyDisabled
            ? "Only available for containers"
            : undefined,
          children: (
            <Input
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
          name: "limits_memory_hotplug",
          label: "Memory hotplug limit (VMs only)",
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
          name: "limits_memory_hugepages",
          label: "Back memory with huge pages (VMs only)",
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
          name: "limits_memory_oom_priority",
          label: "OOM killer priority",
          defaultValue: "",
          children: <Input type="number" min={0} />,
        }),
      ]}
    />
  );
};

export default ResourceLimitsForm;
