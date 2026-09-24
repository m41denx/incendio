import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  Icon,
  Input,
  Modal,
  Notification,
  Select,
  usePortal,
  useToastNotification,
} from "@canonical/react-components";
import { usePatchK8sCluster } from "pages/kubernetes/useK8sClusters";

// Odd sizes only: etcd needs a majority, so an even member count adds a way to
// lose quorum without tolerating any extra failure.
const CONTROL_PLANE_SIZES = [1, 3, 5, 7, 9];
const MAX_WORKERS = 100;

interface ModalProps {
  name: string;
  controlPlaneCount: number;
  workerCount: number;
  onClose: () => void;
}

const ScaleClusterModal: FC<ModalProps> = ({
  name,
  controlPlaneCount,
  workerCount,
  onClose,
}) => {
  const toastNotify = useToastNotification();
  const scale = usePatchK8sCluster(name);
  const [controlPlane, setControlPlane] = useState(controlPlaneCount);
  const [workers, setWorkers] = useState(String(workerCount));

  const workerValue = Number(workers);
  const workersValid =
    workers.trim().length > 0 &&
    Number.isInteger(workerValue) &&
    workerValue >= 0 &&
    workerValue <= MAX_WORKERS;
  const changed =
    controlPlane !== controlPlaneCount ||
    (workersValid && workerValue !== workerCount);

  const submit = () => {
    scale.mutate(
      {
        ...(controlPlane !== controlPlaneCount
          ? { controlPlaneCount: controlPlane }
          : {}),
        ...(workerValue !== workerCount ? { workerCount: workerValue } : {}),
      },
      {
        onSuccess: () => {
          toastNotify.success(
            `Scaling cluster "${name}" to ${controlPlane} control plane and ${workerValue} worker nodes.`,
          );
          onClose();
        },
        onError: (error) => {
          toastNotify.failure("Scaling the cluster failed", error);
        },
      },
    );
  };

  return (
    <Modal
      close={onClose}
      title={`Scale cluster ${name}`}
      buttonRow={
        <>
          <Button
            className="u-no-margin--bottom"
            onClick={onClose}
            type="button"
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={scale.isPending}
            disabled={!changed || !workersValid || scale.isPending}
            onClick={submit}
            type="button"
          >
            Scale
          </ActionButton>
        </>
      }
    >
      <Select
        label="Control plane nodes"
        value={String(controlPlane)}
        options={CONTROL_PLANE_SIZES.map((n) => ({
          label: String(n),
          value: String(n),
        }))}
        help="Odd sizes keep etcd quorum. 3 or more gives a highly available control plane."
        onChange={(e) => {
          setControlPlane(Number(e.target.value));
        }}
      />
      <Input
        type="number"
        label="Worker nodes"
        min={0}
        max={MAX_WORKERS}
        value={workers}
        error={
          workersValid
            ? undefined
            : `Enter a whole number from 0 to ${MAX_WORKERS}`
        }
        onChange={(e) => {
          setWorkers(e.target.value);
        }}
      />
      {workersValid && workerValue < workerCount ? (
        <Notification severity="caution" title="Scaling down">
          Cluster API drains and deletes {workerCount - workerValue} worker node
          {workerCount - workerValue === 1 ? "" : "s"} and their Incus
          instances. Workloads are rescheduled onto the remaining nodes.
        </Notification>
      ) : null}
    </Modal>
  );
};

interface Props {
  name: string;
  controlPlaneCount: number;
  workerCount: number;
}

const ScaleClusterBtn: FC<Props> = (props) => {
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  return (
    <>
      <Button hasIcon onClick={openPortal}>
        <Icon name="resize" />
        <span>Scale</span>
      </Button>
      {isOpen && (
        <Portal>
          <ScaleClusterModal {...props} onClose={closePortal} />
        </Portal>
      )}
    </>
  );
};

export default ScaleClusterBtn;
