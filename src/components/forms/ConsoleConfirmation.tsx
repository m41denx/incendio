import type { FC } from "react";
import { ConfirmationModal } from "@canonical/react-components";

interface Props {
  onConfirm: () => void;
  close: () => void;
}

const ConsoleConfirmation: FC<Props> = ({ onConfirm, close }) => {
  return (
    <ConfirmationModal
      confirmButtonLabel="Connect"
      cancelButtonLabel="Cancel"
      onConfirm={onConfirm}
      close={close}
      title="Confirm"
    >
      <p>
        This will disconnect other user session.
        <br />
        Are you sure you want to proceed?
      </p>
    </ConfirmationModal>
  );
};

export default ConsoleConfirmation;
