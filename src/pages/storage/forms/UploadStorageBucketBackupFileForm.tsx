import {
  ActionButton,
  Button,
  Form,
  Input,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useCurrentProject } from "context/useCurrentProject";
import StoragePoolSelector from "pages/storage/StoragePoolSelector";
import { useCallback, useState, type ChangeEvent, type FC } from "react";
import { fileToSanitisedName } from "util/helpers";
import { ROOT_PATH } from "util/rootPath";
import type { UploadState } from "types/upload";
import { useEventQueue } from "context/eventQueue";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "util/queryKeys";
import { useFormik } from "formik";
import type { AxiosError } from "axios";
import type { LxdSyncResponse } from "types/apiResponse";
import * as Yup from "yup";
import classnames from "classnames";
import ResourceLink from "components/ResourceLink";
import ResourceLabel from "components/ResourceLabel";
import { uploadStorageBucket } from "api/storage-buckets";
import {
  getStorageBucketURL,
  testDuplicateStorageBucketName,
} from "util/storageBucket";
import ClusterMemberSelector from "pages/cluster/ClusterMemberSelector";
import { useStoragePools } from "context/useStoragePools";
import { isClusterLocalDriver } from "util/storagePool";
import { useClusterMembers } from "context/useClusterMembers";
import type { UploadStorageBucketBackupFileFormValues } from "types/forms/uploadStorageBucketBackupFile";

interface Props {
  close: () => void;
  uploadState: UploadState | null;
  setUploadState: (state: UploadState | null) => void;
}

const UploadStorageBucketBackupFileForm: FC<Props> = ({
  close,
  uploadState,
  setUploadState,
}) => {
  const { project, isLoading } = useCurrentProject();
  const eventQueue = useEventQueue();
  const toastNotify = useToastNotification();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [uploadAbort, setUploadAbort] = useState<AbortController | null>(null);
  const bucketNameAbort = useState<AbortController | null>(null);
  const { data: pools = [] } = useStoragePools(true, project?.name);
  const { data: clusterMembers = [] } = useClusterMembers();

  const handleSuccess = (bucketName: string, pool: string) => {
    const bucketURL = getStorageBucketURL(
      bucketName,
      pool,
      project?.name ?? "",
    );

    toastNotify.success(
      <>
        Created bucket{" "}
        <ResourceLink type="bucket" value={bucketName} to={bucketURL} />.
      </>,
    );
  };

  const handleFailure = (msg: string) => {
    toastNotify.failure("Bucket creation failed.", new Error(msg));
  };

  const handleFinish = () => {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.includes(queryKeys.buckets),
    });
  };

  const handleUpload = (values: UploadStorageBucketBackupFileFormValues) => {
    const uploadController = new AbortController();
    setUploadAbort(uploadController);

    const targetClusterMember = isCMSDriver ? values.clusterMember : "";

    uploadStorageBucket(
      values.bucketFile,
      values.name,
      project?.name ?? "",
      values.pool,
      setUploadState,
      uploadController,
      targetClusterMember,
    )
      .then((operation) => {
        toastNotify.info(
          <>
            Upload completed. Now creating bucket{" "}
            <ResourceLabel bold type="bucket" value={values.name} />.
          </>,
        );

        eventQueue.set(
          operation.metadata.id,
          () => {
            handleSuccess(values.name, values.pool);
          },
          handleFailure,
          handleFinish,
        );

        handleCloseModal();
        navigate(
          `${ROOT_PATH}/ui/project/${encodeURIComponent(project?.name ?? "")}/storage/buckets`,
        );
      })
      .catch((e: AxiosError<LxdSyncResponse<null>>) => {
        const error = new Error(e.response?.data.error);
        notify.failure("Bucket upload failed", error);
        formik.setSubmitting(false);
        setUploadState(null);
      });
  };

  const formik = useFormik<UploadStorageBucketBackupFileFormValues>({
    initialValues: {
      name: "",
      pool: "",
      bucketFile: null,
      clusterMember: clusterMembers?.[0]?.server_name ?? "",
    },
    validateOnMount: true,
    enableReinitialize: true,
    validationSchema: Yup.object().shape({
      name: Yup.string()
        .min(3, "Name must be at least 3 characters")
        .max(63, "Name must be at most 63 characters")
        .matches(
          /^[a-z0-9][a-z0-9.-]*$/,
          "Name must contain only lowercase letters, numbers, periods, or hyphens and must start with a letter or number",
        )
        .test(
          ...testDuplicateStorageBucketName(
            project?.name || "",
            bucketNameAbort,
          ),
        )
        .required("Bucket name is required"),
    }),
    onSubmit: handleUpload,
  });

  const pool = pools.find((pool) => pool.name === formik.values.pool);
  const isCMSDriver = isClusterLocalDriver(pool?.driver || "");

  const handleCloseModal = useCallback(() => {
    uploadAbort?.abort();
    setUploadState(null);
    setUploadAbort(null);
    formik.resetForm();
    close();
    notify.clear();
  }, [uploadAbort, formik.resetForm, close, notify]);

  const changeFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const { onChange } = formik.getFieldProps("bucketFile");
    onChange(e);

    if (e.currentTarget.files) {
      const file = e.currentTarget.files[0];
      await formik.setFieldValue("bucketFile", file);

      const bucketName = fileToSanitisedName(file.name, "-import");
      await formik.setFieldValue("name", bucketName);

      // validate bucket name
      await formik.validateField("name");
      void formik.setFieldTouched("name", true, true);
      if (!formik.errors.name) {
        formik.setFieldError("name", undefined);
      }
    }
  };

  const noFileSelectedMessage = !formik.values.bucketFile
    ? "Please select a file before adding custom configuration."
    : "";

  return (
    <>
      <Form
        onSubmit={formik.handleSubmit}
        className={classnames({ "u-hide": uploadState })}
      >
        <Input
          id="bucket-file"
          name="bucketFile"
          type="file"
          accept=".tar, application/gzip, application/x-bzip, application/x-xz, application/x-lzma, application/zstd"
          label="Incus bucket backup archive (.tar.gz)"
          onChange={(e) => void changeFile(e)}
        />
        <Input
          {...formik.getFieldProps("name")}
          id="name"
          type="text"
          label="New bucket name"
          placeholder="Enter name"
          onChange={formik.handleChange}
          error={formik.touched.name ? formik.errors.name : null}
          disabled={!!noFileSelectedMessage}
          title={noFileSelectedMessage}
        />
        <StoragePoolSelector
          value={formik.values.pool}
          setValue={(value) => {
            void formik.setFieldValue("pool", value);
          }}
          selectProps={{
            id: "bucket-import-pool",
            label: "Storage pool",
            disabled: isLoading || !!noFileSelectedMessage,
            title: noFileSelectedMessage,
          }}
        />
        <ClusterMemberSelector
          {...formik.getFieldProps("clusterMember")}
          id="clusterMember"
          label="Target cluster member"
          disabled={!!noFileSelectedMessage || !isCMSDriver}
          disableReason={
            !isCMSDriver
              ? "The selected pool is not cluster specific"
              : noFileSelectedMessage
          }
        />
      </Form>
      <footer className="p-modal__footer" id="modal-footer">
        <Button
          appearance="base"
          className="u-no-margin--bottom"
          type="button"
          onClick={handleCloseModal}
        >
          Cancel
        </Button>
        <ActionButton
          appearance="positive"
          className="u-no-margin--bottom"
          loading={formik.isSubmitting || !!uploadState}
          disabled={
            !formik.isValid ||
            formik.isSubmitting ||
            isLoading ||
            !formik.values.bucketFile
          }
          onClick={() => void formik.submitForm()}
        >
          Upload and create
        </ActionButton>
      </footer>
    </>
  );
};

export default UploadStorageBucketBackupFileForm;
