import type { FC } from "react";
import { CustomSelect, OutputField } from "@canonical/react-components";
import {
  getCephObjectPoolFormFields,
  getCephPoolFormFields,
  getZfsStoragePoolFormFields,
} from "util/storagePool";
import {
  zfsDriver,
  cephDriver,
  getStorageDriverOptions,
  cephObject,
  storageDriverLabels,
} from "util/storageOptions";
import type { FormikProps } from "formik";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import {
  isStoragePoolWithSize,
  isStoragePoolWithSource,
} from "util/storagePoolForm";
import { useSettings } from "context/useSettings";

interface Props {
  formik: FormikProps<StoragePoolFormValues>;
}

const StorageDriverSelect: FC<Props> = ({ formik }) => {
  const { data: settings } = useSettings();

  const storageDriverOptions = getStorageDriverOptions(settings);

  const cephObjectNotice = (
    <>
      RADOS gateway must be enabled for Ceph Object driver to work. If using
      microcloud or microceph, run <code>microceph enable rgw --port 8080</code>
      .
    </>
  );

  const getHelpText = () => {
    if (!formik.values.isCreating) {
      return "Driver can not be changed";
    } else if (formik.values.driver === zfsDriver) {
      return "ZFS gives best performance and reliability";
    } else if (formik.values.driver === cephObject) {
      return cephObjectNotice;
    }
    return undefined;
  };

  const onChange = (val: string) => {
    if (!val) return;

    if (val !== cephDriver) {
      const cephFields = getCephPoolFormFields();
      for (const field of cephFields) {
        formik.setFieldValue(field, undefined);
      }
    }
    if (val !== cephObject) {
      const cephobjectFields = getCephObjectPoolFormFields();
      for (const field of cephobjectFields) {
        formik.setFieldValue(field, undefined);
      }
    }
    if (val !== zfsDriver) {
      const zfsFields = getZfsStoragePoolFormFields();
      for (const field of zfsFields) {
        formik.setFieldValue(field, undefined);
      }
      formik.setFieldValue("zfsPoolNamePerClusterMember", "");
    }
    if (!isStoragePoolWithSize(val)) {
      formik.setFieldValue("size", undefined);
      formik.setFieldValue("sizePerClusterMember", undefined);
    }
    if (!isStoragePoolWithSource(val)) {
      formik.setFieldValue("source", undefined);
      formik.setFieldValue("sourcePerClusterMember", undefined);
    }
    formik.setFieldValue("driver", val);
  };

  return (
    <>
      {!formik.values.isCreating ? (
        <OutputField
          id={"driver"}
          label={"Driver"}
          value={storageDriverLabels[formik.values.driver]}
          help={getHelpText()}
        />
      ) : (
        <CustomSelect
          id="driver"
          name="driver"
          label="Driver"
          wrapperClassName="select-input"
          dropdownClassName="storage-driver-dropdown"
          help={getHelpText()}
          onChange={onChange}
          options={storageDriverOptions}
          value={formik.values.driver}
          required
          searchable={"never"}
        />
      )}
    </>
  );
};

export default StorageDriverSelect;
