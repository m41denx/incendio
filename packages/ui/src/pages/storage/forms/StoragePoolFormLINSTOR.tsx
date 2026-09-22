import type { FormikProps } from "formik";
import type { FC } from "react";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import { getConfigurationRow } from "components/ConfigurationRow";
import { Input, Select } from "@canonical/react-components";
import { optionTrueFalse } from "util/options";
import { optionRenderer } from "util/formFields";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";

interface Props {
  formik: FormikProps<StoragePoolFormValues>;
}

const StoragePoolFormLINSTOR: FC<Props> = ({ formik }) => {
  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "Resource group name",
          name: "linstor_resource_group_name",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter resource group name" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "Replica place count",
          name: "linstor_resource_group_place_count",
          defaultValue: "",
          children: (
            <Input type="number" placeholder="Enter replica place count" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "Backing storage pool",
          name: "linstor_resource_group_storage_pool",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter backing storage pool" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "Volume name prefix",
          name: "linstor_volume_prefix",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter volume name prefix" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "DRBD policy on quorum loss",
          name: "drbd_on_no_quorum",
          defaultValue: "",
          children: <Input type="text" placeholder="e.g. suspend-io" />,
        }),
        getConfigurationRow({
          formik,
          label: "Auto-add quorum tiebreaker",
          name: "drbd_auto_add_quorum_tiebreaker",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
        getConfigurationRow({
          formik,
          label: "Auto-diskful after",
          name: "drbd_auto_diskful",
          defaultValue: "",
          children: <Input type="text" placeholder="e.g. 60min" />,
        }),
      ]}
    />
  );
};

export default StoragePoolFormLINSTOR;
