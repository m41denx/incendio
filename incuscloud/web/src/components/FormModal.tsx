import { type FC, type FormEvent, type ReactNode, useId, useState } from "react";
import { ActionButton, Button, Form, Modal } from "@canonical/react-components";
import { ErrorMessage } from "./Status";

interface Props {
  title: ReactNode;
  submitLabel: string;
  /** Throws to keep the modal open and show the error (API messages as they come). */
  onSubmit: () => Promise<unknown>;
  onClose: () => void;
  submitDisabled?: boolean;
  children: ReactNode;
}

/** A form in a modal: Cancel / submit, busy state, API errors shown inside. */
const FormModal: FC<Props> = ({ title, submitLabel, onSubmit, onClose, submitDisabled, children }) => {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      close={onClose}
      buttonRow={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <ActionButton appearance="positive" type="submit" form={formId} loading={busy} disabled={submitDisabled || busy}>
            {submitLabel}
          </ActionButton>
        </>
      }
    >
      {error ? <ErrorMessage error={error} title="Not saved" /> : null}
      <Form id={formId} onSubmit={submit}>
        {children}
      </Form>
    </Modal>
  );
};

export default FormModal;
