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

const StoragePoolFormTrueNAS: FC<Props> = ({ formik }) => {
  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "TrueNAS host",
          name: "truenas_host",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter TrueNAS host" />,
        }),
        getConfigurationRow({
          formik,
          label: "API key",
          name: "truenas_api_key",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter API key" />,
        }),
        getConfigurationRow({
          formik,
          label: "Remote dataset",
          name: "truenas_dataset",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter remote dataset" />,
        }),
        getConfigurationRow({
          formik,
          label: "iSCSI portal",
          name: "truenas_portal",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter iSCSI portal" />,
        }),
        getConfigurationRow({
          formik,
          label: "iSCSI initiator",
          name: "truenas_initiator",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter iSCSI initiator" />,
        }),
        getConfigurationRow({
          formik,
          label: "Allow insecure (non-TLS)",
          name: "truenas_allow_insecure",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
        getConfigurationRow({
          formik,
          label: "Clone copy",
          name: "truenas_clone_copy",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
        getConfigurationRow({
          formik,
          label: "Force reuse existing pool",
          name: "truenas_force_reuse",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
        getConfigurationRow({
          formik,
          label: "Client config file path",
          name: "truenas_config",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter client config file path" />
          ),
        }),
      ]}
    />
  );
};

export default StoragePoolFormTrueNAS;
