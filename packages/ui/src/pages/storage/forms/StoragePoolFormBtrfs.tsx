import type { FormikProps } from "formik";
import type { FC } from "react";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import { getConfigurationRow } from "components/ConfigurationRow";
import { Input } from "@canonical/react-components";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";

interface Props {
  formik: FormikProps<StoragePoolFormValues>;
}

const StoragePoolFormBtrfs: FC<Props> = ({ formik }) => {
  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "mkfs.btrfs options",
          name: "btrfs_create_options",
          defaultValue: "",
          children: (
            <Input type="text" placeholder="Enter mkfs.btrfs options" />
          ),
        }),
        getConfigurationRow({
          formik,
          label: "Mount options",
          name: "btrfs_mount_options",
          defaultValue: "",
          children: <Input type="text" placeholder="Enter mount options" />,
        }),
      ]}
    />
  );
};

export default StoragePoolFormBtrfs;
