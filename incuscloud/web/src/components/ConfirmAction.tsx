import { type FC, type ReactNode, useState } from "react";
import { ActionButton, Button, Modal } from "@canonical/react-components";

interface Props {
  /** Button text, also the confirm button's. */
  label: string;
  title: ReactNode;
  children: ReactNode;
  /** Errors are reported through onError; the modal closes either way. */
  onConfirm: () => Promise<unknown>;
  onError?: (e: unknown) => void;
  appearance?: "negative" | "positive" | "base";
  className?: string;
}

/** A button that asks before doing something hard to undo. */
const ConfirmAction: FC<Props> = ({ label, title, children, onConfirm, onError, appearance = "negative", className }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };
  return (
    <>
      <Button type="button" appearance={appearance === "negative" ? "negative" : "default"} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Modal
          title={title}
          close={() => setOpen(false)}
          buttonRow={
            <>
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <ActionButton appearance={appearance} loading={busy} disabled={busy} onClick={confirm}>
                {label}
              </ActionButton>
            </>
          }
        >
          {children}
        </Modal>
      ) : null}
    </>
  );
};

export default ConfirmAction;
