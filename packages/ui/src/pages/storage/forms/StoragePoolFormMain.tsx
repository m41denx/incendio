import type { FC } from "react";
import {
  Row,
  Input,
  Col,
  OutputField,
  Select,
} from "@canonical/react-components";
import type { FormikProps } from "formik";
import { dirDriver, cephObject, zfsDriver } from "util/storageOptions";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import DiskSizeSelector from "components/forms/DiskSizeSelector";
import AutoExpandingTextArea from "components/AutoExpandingTextArea";
import { composeZfsVdevSource, hasSource } from "util/storagePool";
import { useSettings } from "context/useSettings";
import ScrollableForm from "components/ScrollableForm";
import { ensureEditMode } from "util/editMode";
import { isClusteredServer } from "util/settings";
import ClusteredDiskSizeSelector from "components/forms/ClusteredDiskSizeSelector";
import { isStoragePoolWithSize, getFormProps } from "util/storagePoolForm";
import StoragePoolSource from "./StoragePoolSource";
import StorageDriverSelect from "./StorageDriverSelect";
import { useSupportedFeatures } from "context/useSupportedFeatures";

interface Props {
  formik: FormikProps<StoragePoolFormValues>;
}

const StoragePoolFormMain: FC<Props> = ({ formik }) => {
  const { data: settings } = useSettings();
  const { hasRemoteDropSource } = useSupportedFeatures();
  const isCreating = formik.values.isCreating;
  const isCephObjectDriver = formik.values.driver === cephObject;
  const showZfsVdevBuilder =
    isCreating &&
    formik.values.driver === zfsDriver &&
    !isClusteredServer(settings);

  const updateZfsVdev = (type: string, devices: string) => {
    formik.setFieldValue("zfs_vdev_type", type);
    formik.setFieldValue("zfs_vdev_devices", devices);
    formik.setFieldValue("source", composeZfsVdevSource(type, devices));
  };

  return (
    <ScrollableForm>
      <Row>
        <Col size={12}>
          {isCreating ? (
            <Input
              {...getFormProps(formik, "name")}
              type="text"
              label="Name"
              required
            />
          ) : (
            <OutputField
              id="name"
              label="Name"
              value={formik.values.name}
              help="Storage pools cannot be renamed."
            />
          )}
          <AutoExpandingTextArea
            {...getFormProps(formik, "description")}
            label="Description"
            onChange={(e) => {
              ensureEditMode(formik);
              formik.handleChange(e);
            }}
            disabled={!!formik.values.editRestriction}
            title={formik.values.editRestriction}
          />
          <StorageDriverSelect formik={formik} />
          {isStoragePoolWithSize(formik.values.driver) &&
            (isClusteredServer(settings) ? (
              <ClusteredDiskSizeSelector
                id="sizePerClusterMember"
                values={formik.values.sizePerClusterMember}
                setValue={(value) => {
                  ensureEditMode(formik);
                  formik.setFieldValue("sizePerClusterMember", value);
                }}
                helpText={
                  "When left blank, defaults to 20% of free disk space. Default will be between 5GiB and 30GiB"
                }
                disabledReason={formik.values.editRestriction}
              />
            ) : (
              <DiskSizeSelector
                label="Size"
                value={formik.values.size}
                help={
                  formik.values.driver === dirDriver
                    ? "Not available"
                    : "When left blank, defaults to 20% of free disk space. Default will be between 5GiB and 30GiB"
                }
                setMemoryLimit={(val?: string) => {
                  ensureEditMode(formik);
                  formik.setFieldValue("size", val);
                }}
                disabled={
                  !!formik.values.editRestriction ||
                  formik.values.driver === dirDriver
                }
                disabledReason={formik.values.editRestriction}
              />
            ))}
          <StoragePoolSource
            formik={formik}
            settings={settings}
            hasSource={hasSource(formik.values.driver, hasRemoteDropSource)}
          />
          {showZfsVdevBuilder && (
            <>
              <Select
                id="zfs_vdev_type"
                name="zfs_vdev_type"
                label="ZFS vdev type"
                value={formik.values.zfs_vdev_type ?? "stripe"}
                options={[
                  { label: "Stripe (no redundancy)", value: "stripe" },
                  { label: "Mirror", value: "mirror" },
                  { label: "RAIDZ1", value: "raidz1" },
                  { label: "RAIDZ2", value: "raidz2" },
                ]}
                onChange={(e) => {
                  updateZfsVdev(
                    e.target.value,
                    formik.values.zfs_vdev_devices ?? "",
                  );
                }}
                disabled={!!formik.values.editRestriction}
                help="Redundancy layout used when creating a new ZFS pool from the block devices below."
              />
              <Input
                id="zfs_vdev_devices"
                name="zfs_vdev_devices"
                type="text"
                label="vdev block devices"
                placeholder="/dev/sdb,/dev/sdc"
                value={formik.values.zfs_vdev_devices ?? ""}
                onChange={(e) => {
                  updateZfsVdev(
                    formik.values.zfs_vdev_type ?? "stripe",
                    e.target.value,
                  );
                }}
                disabled={!!formik.values.editRestriction}
                help="Comma-separated block devices. This composes the Source field above. Leave blank to enter Source manually (e.g. an existing pool or dataset)."
              />
            </>
          )}
          {isCephObjectDriver && (
            <>
              <Input
                {...formik.getFieldProps("cephobject_radosgw_endpoint")}
                type="text"
                label="Rados gateway endpoint"
                placeholder="Enter rados gateway endpoint"
                help="URL of the rados gateway process"
                onChange={(e) => {
                  ensureEditMode(formik);
                  formik.handleChange(e);
                }}
                required
              />
            </>
          )}
        </Col>
      </Row>
    </ScrollableForm>
  );
};

export default StoragePoolFormMain;
