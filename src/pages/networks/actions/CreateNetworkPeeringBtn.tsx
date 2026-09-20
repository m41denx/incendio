import type { FC } from "react";
import { Button, Icon } from "@canonical/react-components";
import { useIsScreenBelow } from "context/useIsScreenBelow";
import { useNetworkEntitlements } from "util/entitlements/networks";
import usePanelParams from "util/usePanelParams";
import type { LxdNetwork } from "types/network";
import classnames from "classnames";

interface Props {
  network: LxdNetwork;
  className?: string;
}

const CreateNetworkPeeringBtn: FC<Props> = ({ network, className }) => {
  const isSmallScreen = useIsScreenBelow();
  const { canEditNetwork } = useNetworkEntitlements();
  const panelParams = usePanelParams();

  return (
    <Button
      appearance="positive"
      hasIcon={!isSmallScreen}
      onClick={() => {
        panelParams.openCreateLocalPeering();
      }}
      className={classnames("p-button--positive", className)}
      disabled={!canEditNetwork(network)}
      title={
        canEditNetwork(network)
          ? "Create peering"
          : "You do not have permission to create peerings for this network"
      }
    >
      {!isSmallScreen && <Icon name="plus" light />}
      <span>Create peering</span>
    </Button>
  );
};

export default CreateNetworkPeeringBtn;
