import type { FC } from "react";
import { useFormik } from "formik";
import {
  ActionButton,
  Button,
  Form,
  Input,
  Modal,
  Select,
  useToastNotification,
} from "@canonical/react-components";
import { useEventQueue } from "context/eventQueue";
import type { LxdStorageBucket } from "types/storage";
import { createStorageBucketBackup } from "api/storage-buckets";
import { addTarget } from "util/target";
import { ROOT_PATH } from "util/rootPath";

interface Props {
  bucket: LxdStorageBucket;
  project: string;
  close: () => void;
}

export interface LxdBucketExport {
  compression: "gzip" | "none";
  expirationHours: number;
}

const ExportStorageBucketModal: FC<Props> = ({ bucket, project, close }) => {
  const eventQueue = useEventQueue();
  const toastNotify = useToastNotification();

  const startDownload = (backupName: string) => {
    const params = new URLSearchParams();
    params.set("project", project);
    addTarget(params, bucket.location);

    const url = `${ROOT_PATH}/1.0/storage-pools/${encodeURIComponent(bucket.pool)}/buckets/${encodeURIComponent(bucket.name)}/backups/${encodeURIComponent(backupName)}/export?${params.toString()}`;

    const a = document.createElement("a");
    a.href = url;
    a.download = backupName;
    a.click();
    window.URL.revokeObjectURL(url);

    toastNotify.success(
      <>
        Bucket <strong>{bucket.name}</strong> download started:
        <br />
        <a href={url}>{backupName}</a>
      </>,
    );
  };

  const getNowInHours = (hours: number) => {
    const result = new Date();
    result.setHours(result.getHours() + hours);
    return result;
  };

  const exportBucket = (values: LxdBucketExport) => {
    const currentTime = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .split(".")[0];
    const backupName = `${bucket.name}-${currentTime}.tar${values.compression === "gzip" ? ".gz" : ""}`;

    const payload = JSON.stringify({
      name: backupName,
      expires_at: getNowInHours(values.expirationHours).toISOString(),
      compression_algorithm: values.compression,
    });

    createStorageBucketBackup(bucket, project, payload)
      .then((operation) => {
        toastNotify.info(
          <>
            Backing up bucket <strong>{bucket.name}</strong>.<br />
            Download will start when the export is ready.
          </>,
        );
        eventQueue.set(
          operation.metadata.id,
          () => {
            startDownload(backupName);
          },
          (msg) =>
            toastNotify.failure(
              `Could not download bucket ${bucket.name}`,
              new Error(msg),
            ),
        );
      })
      .catch((e) =>
        toastNotify.failure(`Could not download bucket ${bucket.name}`, e),
      )
      .finally(() => {
        close();
      });
  };

  const formik = useFormik<LxdBucketExport>({
    initialValues: {
      compression: "gzip",
      expirationHours: 6,
    },
    onSubmit: (values) => {
      exportBucket(values);
    },
  });

  return (
    <Modal
      close={close}
      className="export-bucket-modal"
      title="Export bucket"
      buttonRow={
        <>
          <Button
            appearance="base"
            className="u-no-margin--bottom"
            type="button"
            onClick={close}
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={formik.isSubmitting}
            disabled={formik.isSubmitting}
            onClick={() => void formik.submitForm()}
          >
            Export bucket
          </ActionButton>
        </>
      }
    >
      <Form onSubmit={formik.handleSubmit}>
        <Select
          {...formik.getFieldProps("compression")}
          id="compression"
          label="Compression"
          help="No compression will be faster, but larger"
          options={[
            { value: "gzip", label: "Gzip" },
            { value: "none", label: "None" },
          ]}
        />
        <Input
          {...formik.getFieldProps("expirationHours")}
          id="expirationHours"
          type="number"
          min={1}
          label="Backup expiry (hours)"
          help="The backup is auto-deleted after this many hours"
        />
        {/* hidden submit to enable enter key in inputs */}
        <Input type="submit" hidden value="Hidden input" />
      </Form>
    </Modal>
  );
};

export default ExportStorageBucketModal;
