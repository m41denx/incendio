import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  Icon,
  Modal,
  Notification,
  Select,
  usePortal,

} from "@canonical/react-components";
import { ErrorMessage } from "../../components/Status";
import { useK8sOptions, usePatchK8sCluster } from "./useK8sClusters";
import { upgradeTargets } from "@incendio/ui/util/k8s/upgrade";

interface ModalProps {
  id: string;
  name: string;
  version: string;
  targets: string[];
  onClose: () => void;
}

const UpgradeClusterModal: FC<ModalProps> = ({
  id,
  name,
  version,
  targets,
  onClose,
}) => {

  const patch = usePatchK8sCluster(id);
  const [target, setTarget] = useState(targets[0] ?? "");

  const submit = () => {
    patch.mutate(
      { version: target },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      close={onClose}
      title={`Upgrade cluster ${name}`}
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
            loading={patch.isPending}
            disabled={!target || patch.isPending}
            onClick={submit}
            type="button"
          >
            Upgrade
          </ActionButton>
        </>
      }
    >
      {patch.error ? <ErrorMessage error={patch.error} /> : null}
      <p>
        Current version: <strong>{version}</strong>
      </p>
      <Select
        label="Upgrade to"
        value={target}
        options={targets.map((v) => ({ label: v, value: v }))}
        help="Kubernetes upgrades one minor version at a time."
        onChange={(e) => {
          setTarget(e.target.value);
        }}
      />
      <Notification severity="information" title="Rolling upgrade">
        Cluster API replaces every node with a new Incus instance running{" "}
        {target}: control-plane nodes first, then workers, one at a time. Each
        worker is drained before it is removed, so workloads move to the other
        nodes. It cannot be rolled back.
      </Notification>
    </Modal>
  );
};

interface Props {
  id: string;
  name: string;
  /** The cluster's target Kubernetes version. */
  version: string;
  status: string;
  /** The agent supports upgrades (0.2.0+). */
  supported: boolean;
}

const UpgradeClusterBtn: FC<Props> = ({ id, name, version, status, supported }) => {
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  const options = useK8sOptions();
  const targets = upgradeTargets(version, options.data?.versions ?? []);
  const disabledReason = !supported
    ? "Update the Kubernetes agent (Kubernetes settings → Management appliance) to upgrade clusters"
    : status !== "ready"
      ? "Wait until the cluster is ready"
      : targets.length === 0
        ? `${version} is the newest version with a kubeadm image`
        : undefined;

  return (
    <>
      <Button
        hasIcon
        onClick={openPortal}
        disabled={disabledReason !== undefined}
        title={disabledReason}
      >
        <Icon name="change-version" />
        <span>Upgrade</span>
      </Button>
      {isOpen && (
        <Portal>
          <UpgradeClusterModal
            id={id}
            name={name}
            version={version}
            targets={targets}
            onClose={closePortal}
          />
        </Portal>
      )}
    </>
  );
};

export default UpgradeClusterBtn;
