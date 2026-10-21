import { useState, type FC } from "react";
import { ActionButton, Button, Icon, Modal, Spinner, usePortal } from "@canonical/react-components";
import MetalLBAddressInput from "@incendio/ui/pages/kubernetes/MetalLBAddressInput";
import { metallbAddressesError } from "@incendio/ui/util/k8s/metallb";
import { ErrorMessage } from "../../components/Status";
import { useSetK8sMetalLB, useK8sMetalLB } from "./useK8sClusters";
import { ranges } from "./quota";
interface ModalProps {
  id: string;
  name: string;
  current: string[];
  onClose: () => void;
}

const MetalLBAddressesModal: FC<ModalProps> = ({ id, name, current, onClose }) => {
  const change = useSetK8sMetalLB(id);
  const [value, setValue] = useState(current.join(", "));
  const error = metallbAddressesError(value);
  const installing = current.length === 0;

  const submit = () => {
    change.mutate(ranges(value), {
      onSuccess: () => {
        onClose();
      },
    });
  };

  return (
    <Modal
      close={onClose}
      title={installing ? "Install MetalLB" : "Change MetalLB addresses"}
      buttonRow={
        <>
          <Button
            className="u-no-margin--bottom"
            type="button"
            onClick={onClose}
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={change.isPending}
            disabled={error !== null || change.isPending}
            onClick={submit}
          >
            {installing ? "Install" : "Save"}
          </ActionButton>
        </>
      }
    >
      {change.error ? <ErrorMessage error={change.error} /> : null}
      <MetalLBAddressInput
        id="metallb-addresses"
        value={value}
        error={value ? error : null}
        onChange={setValue}
      />
      {!installing ? (
        <p className="u-text--muted">
          Services keep the addresses they have unless those leave the pool.
        </p>
      ) : null}
    </Modal>
  );
};


const ClusterMetalLB: FC<{id:string;name:string;canEdit:boolean;ready:boolean}> = ({id,name,canEdit,ready}) => {
  const {data,error,isLoading} = useK8sMetalLB(id);
  const {openPortal,closePortal,isOpen,Portal} = usePortal({programmaticallyOpen:true});
  if (isLoading) return <Spinner text="Loading..." />;
  if (error || !data) return <p className="u-text--muted">MetalLB status is not available right now{error ? `: ${error.message}` : ""}.</p>;
  const current = data.addresses.length ? data.addresses : data.requested ?? [];
  return <>
    <p><Icon name={data.ready ? "status-succeeded-small" : "status-waiting-small"} className="status-icon" />{data.ready ? "Installed" : data.installed ? "Installing" : data.requested ? "Waiting for the cluster to be ready" : "Not installed"}</p>
    {data.message ? <p className="u-text--muted">{data.message}</p> : null}
    {current.length ? <p><span className="u-text--muted">Address pool </span><code>{current.join(", ")}</code></p> : null}
    {canEdit ? <div className="k8s-metallb-actions"><Button onClick={openPortal} disabled={!ready}>{data.installed ? "Change addresses" : "Install MetalLB"}</Button></div> : null}
    {isOpen && <Portal><MetalLBAddressesModal id={id} name={name} current={current} onClose={closePortal} /></Portal>}
  </>;
};
export default ClusterMetalLB;
