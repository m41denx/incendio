import type { FC } from "react";
import { Select } from "@canonical/react-components";
import type { StorageVolumeFormValues } from "types/forms/storageVolume";
import type { FormikProps } from "formik/dist/types";
import { getConfigurationRow } from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";

interface Props {
  formik: FormikProps<StorageVolumeFormValues>;
}

const StorageVolumeFormBtrfs: FC<Props> = ({ formik }) => {
  return (
    <ScrollableConfigurationTable
      rows={[
        getConfigurationRow({
          formik,
          label: "Compression",
          name: "btrfs_compression",
          defaultValue: "",
          children: (
            <Select
              options={[
                { label: "default", value: "" },
                { label: "none", value: "none" },
                { label: "zstd", value: "zstd" },
                { label: "lzo", value: "lzo" },
                { label: "zlib", value: "zlib" },
              ]}
            />
          ),
        }),
      ]}
    />
  );
};

export default StorageVolumeFormBtrfs;
