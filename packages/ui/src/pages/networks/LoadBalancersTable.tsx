import { type FC } from "react";
import { Icon, MainTable, Tooltip } from "@canonical/react-components";
import type { LxdNetwork } from "types/network";
import DeleteLoadBalancerBtn from "pages/networks/actions/DeleteLoadBalancerBtn";
import type { LxdLoadBalancer } from "types/loadBalancers";
import LoadBalancerPortStatus from "pages/networks/LoadBalancerPortStatus";
import LoadBalancerPoolChip from "pages/networks/LoadBalancerPoolChip";
import EditLoadBalancerBtn from "pages/networks/actions/EditLoadBalancerBtn";
import { isLegacyLoadBalancer } from "util/loadBalancers";
import { useSupportedFeatures } from "context/useSupportedFeatures";

interface Props {
  network: LxdNetwork;
  loadBalancers: LxdLoadBalancer[];
  project: string;
}

const LoadBalancersTable: FC<Props> = ({ network, loadBalancers, project }) => {
  const { hasLoadBalancerPools } = useSupportedFeatures();
  // Incus uses the backend model; there is no pool concept, and these load
  // balancers are fully editable (not "legacy" read-only).
  const useBackends = !hasLoadBalancerPools;

  const headers = [
    { content: "Listen address", sortKey: "listenAddress" },
    {
      content: <>Listen port</>,
      className: "u-align--right listen-port",
    },
    useBackends
      ? { content: <>Target backend</> }
      : { content: <>Target pool</> },
    useBackends
      ? { content: <>Backends</> }
      : { content: "Pool status", className: "status-header status" },
    {
      "aria-label": "Actions",
      className: "u-align--right actions",
    },
  ];

  const rows = loadBalancers.map((loadBalancer) => {
    const targetColumn = useBackends
      ? {
          content: loadBalancer.ports.map((port) => (
            <div key={port.protocol + port.listen_port}>
              {(port.target_backend ?? []).join(", ") || "-"}
            </div>
          )),
          role: "cell",
          "aria-label": "Target backend",
        }
      : {
          content: loadBalancer.ports.map((port) => (
            <div key={port.protocol + port.listen_port}>
              <LoadBalancerPoolChip
                name={port.target_pool ?? ""}
                network={network.name}
                project={project}
              />
            </div>
          )),
          role: "cell",
          "aria-label": "Target pool",
        };

    const statusColumn = useBackends
      ? {
          content: (loadBalancer.backends ?? []).map((backend) => (
            <div key={backend.name} className="mono-font">
              {backend.name}
              {backend.target_address
                ? ` → ${backend.target_address}:${backend.target_port}`
                : ""}
            </div>
          )),
          role: "cell",
          "aria-label": "Backends",
        }
      : {
          content: loadBalancer.ports.map((port) => (
            <div key={port.protocol + port.listen_port}>
              <LoadBalancerPortStatus
                network={network}
                project={project}
                port={port}
                loadBalancer={loadBalancer}
              />
            </div>
          )),
          role: "cell",
          className: "status",
          "aria-label": "Status",
        };

    return {
      key: loadBalancer.listen_address,
      columns: [
        {
          content: (
            <>
              {loadBalancer.listen_address}
              {!useBackends && isLegacyLoadBalancer(loadBalancer) ? (
                <>
                  {" "}
                  <Tooltip
                    message={
                      <>
                        Legacy backend configurations are read-only.
                        <br />
                        Create a new configuration using load balancer pools
                        instead.
                      </>
                    }
                  >
                    <Icon name="warning" className="u-margin--left" />
                  </Tooltip>
                </>
              ) : null}
              {loadBalancer.description && (
                <div className="u-text--muted">{loadBalancer.description}</div>
              )}
            </>
          ),
          role: "cell",
          "aria-label": "Listen address",
        },
        {
          content: loadBalancer.ports.map((port) => (
            <div key={port.protocol + port.listen_port}>
              {port.listen_port}/{port.protocol}
            </div>
          )),
          role: "cell",
          "aria-label": "Listen ports",
          className: "u-align--right listen-port",
        },
        targetColumn,
        statusColumn,
        {
          content: (
            <>
              <EditLoadBalancerBtn
                network={network}
                project={project}
                loadBalancer={loadBalancer}
              />
              <DeleteLoadBalancerBtn
                network={network}
                project={project}
                loadBalancer={loadBalancer}
              />
            </>
          ),
          role: "cell",
          className: "u-align--right actions",
          "aria-label": "Actions",
        },
      ],
      sortData: {
        listenAddress: loadBalancer.listen_address,
      },
    };
  });

  return (
    <MainTable
      id="load-balancers-table"
      headers={headers}
      responsive
      rows={rows}
      paginate={30}
      sortable
      defaultSort="listenAddress"
      defaultSortDirection="ascending"
      className="load-balancers-table"
      emptyStateMsg="No data to display"
    />
  );
};

export default LoadBalancersTable;
