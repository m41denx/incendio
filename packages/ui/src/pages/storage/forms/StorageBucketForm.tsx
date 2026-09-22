import type { FC, ReactNode } from "react";
import {
  Form,
  Input,
  Notification,
  OutputField,
} from "@canonical/react-components";
import type { FormikProps } from "formik/dist/types";
import AutoExpandingTextArea from "components/AutoExpandingTextArea";
import StoragePoolSelector from "../StoragePoolSelector";
import DiskSizeSelector from "components/forms/DiskSizeSelector";
import DocLink from "components/DocLink";
import { useStorageBucketEntitlements } from "util/entitlements/storage-buckets";
import type { LxdStorageBucket } from "types/storage";
import type { StorageBucketFormValues } from "types/forms/storageBucket";
import { useSettings } from "context/useSettings";
import { useStoragePools } from "context/useStoragePools";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { cephObject } from "util/storageOptions";

interface Props {
  formik: FormikProps<StorageBucketFormValues>;
  bucket?: LxdStorageBucket;
}

const StorageBucketForm: FC<Props> = ({ formik, bucket }) => {
  const { canEditBucket } = useStorageBucketEntitlements();
  const { data: settings } = useSettings();
  const { data: pools = [] } = useStoragePools(true);
  const { hasStorageBucketsLocal } = useSupportedFeatures();

  const selectedPool = pools.find((pool) => pool.name === formik.values.pool);
  const bucketsAddress = settings?.config?.["core.storage_buckets_address"];
  // cephobject pools serve buckets natively; every other (local) driver needs
  // the server-wide S3 listener address, otherwise the bucket gets no URL.
  const isLocalPool = !!selectedPool && selectedPool.driver !== cephObject;
  const showLocalBucketWarning =
    hasStorageBucketsLocal && isLocalPool && !bucketsAddress;
  const getFormProps = (id: "name" | "description") => {
    return {
      id: id,
      name: id,
      onBlur: formik.handleBlur,
      onChange: formik.handleChange,
      value: formik.values[id] ?? "",
      error: formik.touched[id] ? (formik.errors[id] as ReactNode) : null,
      placeholder: `Enter ${id.replaceAll("_", " ")}`,
    };
  };

  const isEditing = !!bucket;

  const bucketEditRestriction =
    !isEditing || canEditBucket(bucket)
      ? ""
      : "You do not have permission to modify this bucket";

  return (
    <Form onSubmit={formik.handleSubmit} className={"bucket-create-form"}>
      {/* hidden submit to enable enter key in inputs */}
      <Input type="submit" hidden value="Hidden input" />

      {isEditing ? (
        <OutputField
          id="storage_bucket_pool"
          label="Storage pool"
          value={formik.values.pool}
          help="Storage bucket pool can't be changed"
        />
      ) : (
        <StoragePoolSelector
          value={formik.values.pool}
          setValue={(value) => void formik.setFieldValue("pool", value)}
          invalidDrivers={[]}
          selectProps={{
            id: "bucket-create-pool",
            label: "Storage pool",
            disabled: !!bucketEditRestriction,
          }}
        />
      )}

      {showLocalBucketWarning && (
        <Notification severity="caution" title="Local storage bucket">
          Buckets on local storage pools require the server address{" "}
          <code>core.storage_buckets_address</code> to be set, otherwise the
          bucket is created without a reachable S3 URL.{" "}
          <DocLink docPath="/howto/storage_buckets/#configure-the-s3-address">
            Learn more
          </DocLink>
        </Notification>
      )}

      {isEditing ? (
        <OutputField
          id="storage_bucket_name"
          label="Name"
          value={formik.values.name}
          help="Storage bucket name can't be changed"
        />
      ) : (
        <Input
          {...getFormProps("name")}
          type="text"
          label="Name"
          required
          disabled={!!bucketEditRestriction}
          title={bucketEditRestriction}
        />
      )}

      <DiskSizeSelector
        label="Size"
        value={formik.values.size}
        setMemoryLimit={(val?: string) => {
          formik.setFieldValue("size", val);
        }}
        disabled={!!bucketEditRestriction}
        disabledReason={bucketEditRestriction}
      />
      <AutoExpandingTextArea
        {...getFormProps("description")}
        label="Description"
        disabled={!!bucketEditRestriction}
        title={bucketEditRestriction}
      />
    </Form>
  );
};

export default StorageBucketForm;
