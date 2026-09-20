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

const StoragePoolFormLVM: FC<Props> = ({ formik }) => {
  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "Volume group name",
          name: "lvm_vg_name",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter volume group name" />,
        }),
        getConfigurationRow({
          formik,
          label: "Thin pool name",
          name: "lvm_thinpool_name",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter thin pool name" />,
        }),
        getConfigurationRow({
          formik,
          label: "Use thin pool",
          name: "lvm_use_thinpool",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
        getConfigurationRow({
          formik,
          label: "Metadata size",
          name: "lvm_metadata_size",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter metadata size" />,
        }),
        getConfigurationRow({
          formik,
          label: "Thin pool metadata size",
          name: "lvm_thinpool_metadata_size",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter thin pool metadata size" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "Force reuse volume group",
          name: "lvm_vg_force_reuse",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
      ]}
    />
  );
};

export default StoragePoolFormLVM;
