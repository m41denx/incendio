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

const StoragePoolFormDir: FC<Props> = ({ formik }) => {
  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "rsync bandwidth limit",
          name: "rsync_bwlimit",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter rsync bandwidth limit" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "rsync compression",
          name: "rsync_compression",
          defaultValue: "",
          children: <Select options={optionTrueFalse} />,
          readOnlyRenderer: (value) => optionRenderer(value, optionTrueFalse),
        }),
      ]}
    />
  );
};

export default StoragePoolFormDir;
