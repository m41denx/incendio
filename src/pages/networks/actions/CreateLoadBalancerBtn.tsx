import type { FC } from "react";
import { Button, Icon } from "@canonical/react-components";
import { useIsScreenBelow } from "context/useIsScreenBelow";
import { useNetworkEntitlements } from "util/entitlements/networks";
import type { LxdNetwork } from "types/network";
import { useNavigate } from "react-router-dom";
import { ROOT_PATH } from "util/rootPath";
import { useLoadBalancerPools } from "context/useLoadBalancerPools";
import { useCurrentProject } from "context/useCurrentProject";
import { useSupportedFeatures } from "context/useSupportedFeatures";

interface Props {
  network: LxdNetwork;
  className?: string;
  appearance?: string;
  hasIcon?: boolean;
}

const CreateLoadBalancerBtn: FC<Props> = ({
  network,
  className,
  appearance = "positive",
  hasIcon = true,
}) => {
  const isSmallScreen = useIsScreenBelow();
  const { canEditNetwork } = useNetworkEntitlements();
  const navigate = useNavigate();
  const { projectName: project } = useCurrentProject();
  const { hasLoadBalancerPools } = useSupportedFeatures();
  const { data: pools = [] } = useLoadBalancerPools(
    network.name,
    project,
    hasLoadBalancerPools,
  );
  // On Incus (backend model) there are no pools, so pool availability is not
  // a prerequisite for creating a load balancer.
  const poolPrerequisiteMet = !hasLoadBalancerPools || pools.length > 0;

  const getTitle = () => {
    if (!poolPrerequisiteMet) {
      return "Create a load balancer pool to enable load balancer creation";
    }

    if (!canEditNetwork(network)) {
      return "You do not have permission to create load balancers for this network";
    }

    return "Create load balancer";
  };

  return (
    <Button
      appearance={appearance}
      hasIcon={!isSmallScreen && hasIcon}
      onClick={() => {
        navigate(
          `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network/${encodeURIComponent(network.name)}/load-balancers/create`,
        );
      }}
      className={className}
      disabled={!canEditNetwork(network) || !poolPrerequisiteMet}
      title={getTitle()}
    >
      {!isSmallScreen && hasIcon && <Icon name="plus" light />}
      <span>Create load balancer</span>
    </Button>
  );
};

export default CreateLoadBalancerBtn;
