import type { FC, KeyboardEvent } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  ActionButton,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Textarea,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { updateSettings } from "api/server";
import { queryKeys } from "util/queryKeys";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import {
  emptyLoggingTarget,
  loggingTargetToConfig,
  type LoggingTarget,
} from "util/serverLogging";

interface Props {
  target?: LoggingTarget;
  existingNames: string[];
  close: () => void;
}

const LEVEL_OPTIONS = [
  { label: "Default", value: "" },
  { label: "debug", value: "debug" },
  { label: "info", value: "info" },
  { label: "warn", value: "warn" },
  { label: "error", value: "error" },
];

const ServerLoggingTargetForm: FC<Props> = ({
  target,
  existingNames,
  close,
}) => {
  const isEdit = Boolean(target);
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { hasServerLoggingWebhook } = useSupportedFeatures();

  const typeOptions = [
    { label: "Loki", value: "loki" },
    { label: "Syslog", value: "syslog" },
    ...(hasServerLoggingWebhook
      ? [{ label: "Webhook", value: "webhook" }]
      : []),
  ];

  const formik = useFormik<LoggingTarget>({
    initialValues: target ?? emptyLoggingTarget(),
    validationSchema: Yup.object().shape({
      name: Yup.string()
        .required("Name is required")
        .matches(
          /^[A-Za-z0-9-_.]+$/,
          "Only alphanumeric, dash, underscore and dot are allowed",
        )
        .test(
          "unique",
          "A logging target with this name already exists",
          (value) => isEdit || !existingNames.includes(value ?? ""),
        ),
      address: Yup.string().required("Address is required"),
    }),
    onSubmit: (values) => {
      updateSettings(loggingTargetToConfig(values))
        .then(() => {
          toastNotify.success(
            `Logging target ${values.name} ${isEdit ? "updated" : "created"}.`,
          );
          queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
          close();
        })
        .catch((e) => {
          toastNotify.failure(
            `${isEdit ? "Updating" : "Creating"} logging target failed`,
            e,
          );
        });
    },
  });

  const handleEscKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      close();
    }
  };

  const isSyslog = formik.values.type === "syslog";

  return (
    <Modal
      close={close}
      title={`${isEdit ? "Edit" : "Create"} logging target`}
      onKeyDown={handleEscKey}
      buttonRow={
        <>
          <Button appearance="base" type="button" onClick={close}>
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            loading={formik.isSubmitting}
            disabled={!formik.isValid || formik.isSubmitting}
            onClick={() => void formik.submitForm()}
          >
            {isEdit ? "Save changes" : "Create"}
          </ActionButton>
        </>
      }
    >
      <Form onSubmit={formik.handleSubmit}>
        <Input
          type="text"
          label="Name"
          required
          disabled={isEdit}
          {...formik.getFieldProps("name")}
          error={formik.touched.name ? formik.errors.name : undefined}
        />
        <Select
          label="Type"
          options={typeOptions}
          {...formik.getFieldProps("type")}
        />
        <Input
          type="text"
          label="Address"
          required
          help={
            isSyslog
              ? "Syslog server address, or empty for the local socket."
              : "Target URL (e.g. https://loki:3100 or a webhook URL)."
          }
          {...formik.getFieldProps("address")}
          error={formik.touched.address ? formik.errors.address : undefined}
        />
        <Select
          label="Log level"
          options={LEVEL_OPTIONS}
          {...formik.getFieldProps("level")}
        />
        <Input
          type="text"
          label="Event types"
          help="Comma-separated event types to forward (e.g. lifecycle,logging,network-acl)."
          {...formik.getFieldProps("types")}
        />
        <Input
          type="text"
          label="Instance name"
          help="Overrides the instance label attached to forwarded events."
          {...formik.getFieldProps("instance")}
        />
        {isSyslog ? (
          <Input
            type="text"
            label="Facility"
            help="Syslog facility (e.g. daemon, local0)."
            {...formik.getFieldProps("facility")}
          />
        ) : (
          <>
            <Input
              type="text"
              label="Username"
              {...formik.getFieldProps("username")}
            />
            <Input
              type="password"
              label="Password"
              {...formik.getFieldProps("password")}
            />
            <Input
              type="number"
              label="Retry count"
              {...formik.getFieldProps("retry")}
            />
            <Input
              type="text"
              label="Labels"
              help="Comma-separated key=value labels attached to forwarded events."
              {...formik.getFieldProps("labels")}
            />
            <Textarea
              label="CA certificate"
              help="PEM CA certificate to verify the target's TLS certificate."
              {...formik.getFieldProps("caCert")}
            />
          </>
        )}
        <Input
          type="text"
          label="Lifecycle projects"
          help="Comma-separated projects to include lifecycle events from."
          {...formik.getFieldProps("lifecycleProjects")}
        />
        <Input
          type="text"
          label="Lifecycle types"
          help="Comma-separated lifecycle event types to include."
          {...formik.getFieldProps("lifecycleTypes")}
        />
      </Form>
    </Modal>
  );
};

export default ServerLoggingTargetForm;
