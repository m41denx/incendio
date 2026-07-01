import type { FC } from "react";
import { Row, Input, Col, OutputField } from "@canonical/react-components";
import type { FormikProps } from "formik";
import { dirDriver, cephObject } from "util/storageOptions";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import DiskSizeSelector from "components/forms/DiskSizeSelector";
import AutoExpandingTextArea from "components/AutoExpandingTextArea";
import { hasSource } from "util/storagePool";
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
