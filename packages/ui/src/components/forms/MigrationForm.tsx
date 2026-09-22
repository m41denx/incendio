import type { FC } from "react";
import { Input, Select } from "@canonical/react-components";
import classnames from "classnames";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import { getConfigurationRow } from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";
import { optionRenderer } from "util/formFields";
import { optionAllowDeny, optionTrueFalse } from "util/options";
import { clusterEvacuationOptions } from "util/instanceOptions";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";
export { migrationPayload } from "util/instanceAndProfilePayloads";

interface Props {
  formik: InstanceAndProfileFormikProps;
}

const MigrationForm: FC<Props> = ({ formik }) => {
  const isInstance = formik.values.entityType === "instance";
  const isVmOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !==
      "virtual-machine";
  const isContainerOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !== "container";

  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "Stateful migration",
          name: "migration_stateful",
          defaultValue: "",
          disabled: isVmOnlyDisabled,
          disabledReason: isVmOnlyDisabled
            ? "Only available for virtual machines"
            : undefined,
          readOnlyRenderer: (val) => optionRenderer(val, optionAllowDeny),
          children: (
            <Select options={optionAllowDeny} disabled={isVmOnlyDisabled} />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "Cluster evacuation",
          name: "cluster_evacuate",
          defaultValue: "auto",
          readOnlyRenderer: (val) =>
            optionRenderer(val, clusterEvacuationOptions),
          children: <Select options={clusterEvacuationOptions} />,
        }),

        getConfigurationRow({
          formik,
          label: "Incremental memory transfer (Containers only)",
          name: "migration_incremental_memory",
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
          label: "Incremental memory sync goal % (Containers only)",
          name: "migration_incremental_memory_goal",
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
          label: "Incremental memory max iterations (Containers only)",
          name: "migration_incremental_memory_iterations",
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
      ]}
    />
  );
};

export default MigrationForm;
