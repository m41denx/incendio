import { useState, type FC } from "react";
import { useFormik } from "formik";
import {
  ActionButton,
  Button,
  ConfirmationButton,
  Icon,
  Input,
  Modal,
  Select,
  usePortal,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

export interface OSActionField {
  name: string;
  label: string;
  type?: "text" | "number" | "checkbox";
  options?: string[];
  defaultValue?: string;
}

export type OSActionValues = Record<string, string | boolean>;
export type OSActionInput = OSActionValues | File | undefined;

interface Props {
  label: string;
  mode: "confirm" | "fields" | "download" | "upload";
  run: (input: OSActionInput) => Promise<unknown>;
  successMessage: string;
  icon?: string;
  destructive?: boolean;
  confirmMessage?: string;
  submitLabel?: string;
  fields?: OSActionField[];
  filename?: string;
  invalidateKeys?: QueryKey[];
}

const OSActionButton: FC<Props> = ({
  label,
  mode,
  run,
  successMessage,
  icon,
  destructive,
  confirmMessage,
  submitLabel,
  fields = [],
  filename = "download",
  invalidateKeys = [],
}) => {
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { openPortal, closePortal, isOpen, Portal } = usePortal();
  const [loading, setLoading] = useState(false);

  const buttonAppearance = icon
    ? "base"
    : destructive
      ? "negative"
      : "positive";

  const onSuccess = () => {
    toastNotify.success(<>{successMessage}</>);
    invalidateKeys.forEach((queryKey) => {
      void queryClient.invalidateQueries({ queryKey });
    });
  };

  const execute = async (input: OSActionInput): Promise<boolean> => {
    setLoading(true);
    try {
      await run(input);
      onSuccess();
      return true;
    } catch (e) {
      toastNotify.failure(`${label} failed`, e);
      return false;
    } finally {
      setLoading(false);
    }
  };

  if (mode === "confirm") {
    return (
      <ConfirmationButton
        appearance={buttonAppearance}
        loading={loading}
        className={icon ? "has-icon is-dense" : undefined}
        title={icon ? label : undefined}
        confirmationModalProps={{
          title: label,
          children: <p>{confirmMessage}</p>,
          onConfirm: () => void execute(undefined),
          confirmButtonLabel: submitLabel ?? label,
          confirmButtonAppearance: destructive ? "negative" : "positive",
        }}
      >
        {icon ? <Icon name={icon} /> : label}
      </ConfirmationButton>
    );
  }

  if (mode === "download") {
    const handleDownload = async () => {
      setLoading(true);
      try {
        const url = (await run(undefined)) as string;
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
        toastNotify.success(<>{successMessage}</>);
      } catch (e) {
        toastNotify.failure(`${label} failed`, e);
      } finally {
        setLoading(false);
      }
    };

    return (
      <ActionButton
        appearance={buttonAppearance}
        loading={loading}
        className={icon ? "has-icon is-dense" : undefined}
        title={label}
        onClick={() => void handleDownload()}
      >
        {icon ? <Icon name={icon} /> : label}
      </ActionButton>
    );
  }

  return (
    <>
      <ActionButton
        appearance={buttonAppearance}
        className={icon ? "has-icon is-dense" : undefined}
        title={label}
        onClick={openPortal}
      >
        {icon ? <Icon name={icon} /> : label}
      </ActionButton>
      {isOpen && (
        <Portal>
          {mode === "fields" ? (
            <OSActionFieldsModal
              title={label}
              confirmMessage={confirmMessage}
              fields={fields}
              submitLabel={submitLabel ?? label}
              destructive={destructive}
              loading={loading}
              onClose={closePortal}
              onSubmit={async (values) => {
                const ok = await execute(values);
                if (ok) {
                  closePortal();
                }
              }}
            />
          ) : (
            <OSActionUploadModal
              title={label}
              loading={loading}
              onClose={closePortal}
              onSubmit={async (file) => {
                const ok = await execute(file);
                if (ok) {
                  closePortal();
                }
              }}
            />
          )}
        </Portal>
      )}
    </>
  );
};

interface FieldsModalProps {
  title: string;
  confirmMessage?: string;
  fields: OSActionField[];
  submitLabel: string;
  destructive?: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: OSActionValues) => Promise<void>;
}

const OSActionFieldsModal: FC<FieldsModalProps> = ({
  title,
  confirmMessage,
  fields,
  submitLabel,
  destructive,
  loading,
  onClose,
  onSubmit,
}) => {
  const initialValues: OSActionValues = {};
  fields.forEach((field) => {
    if (field.type === "checkbox") {
      initialValues[field.name] = false;
    } else {
      initialValues[field.name] = field.defaultValue ?? "";
    }
  });

  const formik = useFormik<OSActionValues>({
    initialValues,
    onSubmit: (values) => void onSubmit(values),
  });

  return (
    <Modal
      close={onClose}
      title={title}
      buttonRow={
        <>
          <Button appearance="base" onClick={onClose}>
            Cancel
          </Button>
          <ActionButton
            appearance={destructive ? "negative" : "positive"}
            loading={loading}
            onClick={() => void formik.submitForm()}
          >
            {submitLabel}
          </ActionButton>
        </>
      }
    >
      {confirmMessage && (
        <p className={destructive ? "u-text--negative" : undefined}>
          {confirmMessage}
        </p>
      )}
      {fields.map((field) => {
        if (field.type === "checkbox") {
          return (
            <Input
              key={field.name}
              type="checkbox"
              label={field.label}
              name={field.name}
              checked={Boolean(formik.values[field.name])}
              onChange={formik.handleChange}
            />
          );
        }

        if (field.options) {
          return (
            <Select
              key={field.name}
              label={field.label}
              name={field.name}
              value={String(formik.values[field.name] ?? "")}
              options={field.options.map((option) => ({
                label: option,
                value: option,
              }))}
              onChange={formik.handleChange}
            />
          );
        }

        return (
          <Input
            key={field.name}
            type={field.type ?? "text"}
            label={field.label}
            name={field.name}
            value={String(formik.values[field.name] ?? "")}
            onChange={formik.handleChange}
          />
        );
      })}
    </Modal>
  );
};

interface UploadModalProps {
  title: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (file: File) => Promise<void>;
}

const OSActionUploadModal: FC<UploadModalProps> = ({
  title,
  loading,
  onClose,
  onSubmit,
}) => {
  const [file, setFile] = useState<File | null>(null);

  return (
    <Modal
      close={onClose}
      title={title}
      buttonRow={
        <>
          <Button appearance="base" onClick={onClose}>
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            loading={loading}
            disabled={!file}
            onClick={() => {
              if (file) {
                void onSubmit(file);
              }
            }}
          >
            Upload
          </ActionButton>
        </>
      }
    >
      <label className="p-form__label" htmlFor="os-action-file">
        File
      </label>
      <input
        id="os-action-file"
        type="file"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
        }}
      />
    </Modal>
  );
};

export default OSActionButton;
