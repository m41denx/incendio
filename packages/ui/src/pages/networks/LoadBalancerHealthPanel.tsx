import type { FC } from "react";
import { Icon, MainTable, Spinner } from "@canonical/react-components";
import { useLoadBalancerState } from "context/useLoadBalancers";

interface Props {
  network: string;
  project: string;
  listenAddress: string;
  enabled?: boolean;
}

const statusIcon = (status: string) => {
  const normalised = status.toLowerCase();
  if (
    normalised === "healthy" ||
    normalised === "online" ||
    normalised === "up"
  ) {
    return <Icon name="status-succeeded-small" aria-label={status} />;
  }
  if (
    normalised === "unhealthy" ||
    normalised === "offline" ||
    normalised === "down"
  ) {
    return <Icon name="status-failed-small" aria-label={status} />;
  }
  return <Icon name="status-waiting-small" aria-label={status} />;
};

const LoadBalancerHealthPanel: FC<Props> = ({
  network,
  project,
  listenAddress,
  enabled,
}) => {
  const {
    data: state,
    isLoading,
    error,
  } = useLoadBalancerState(network, project, listenAddress, enabled);

  if (!enabled) {
    return null;
  }

  const backendHealth = state?.backend_health ?? {};
  const backendNames = Object.keys(backendHealth).sort((a, b) =>
    a.localeCompare(b),
  );

  const headers = [
    { content: "Backend", sortKey: "backend" },
    { content: "Address", sortKey: "address" },
    { content: "Port" },
    { content: "Status" },
  ];

  const rows = backendNames.flatMap((name) => {
    const backend = backendHealth[name];
    const ports = backend.ports ?? [];
    if (ports.length === 0) {
      return [
        {
          key: name,
          columns: [
            { content: name, role: "cell", "aria-label": "Backend" },
            { content: backend.address, role: "cell", "aria-label": "Address" },
            { content: "-", role: "cell", "aria-label": "Port" },
            { content: "-", role: "cell", "aria-label": "Status" },
          ],
        },
      ];
    }
    return ports.map((port, index) => ({
      key: `${name}-${port.protocol}-${port.port}`,
      columns: [
        {
          content: index === 0 ? name : "",
          role: "cell",
          "aria-label": "Backend",
        },
        {
          content: index === 0 ? backend.address : "",
          role: "cell",
          "aria-label": "Address",
        },
        {
          content: `${port.port}/${port.protocol}`,
          role: "cell",
          "aria-label": "Port",
        },
        {
          content: (
            <>
              {statusIcon(port.status)} {port.status}
            </>
          ),
          role: "cell",
          "aria-label": "Status",
        },
      ],
    }));
  });

  return (
    <div className="load-balancer-health">
      <h2 className="p-heading--5">Backend health</h2>
      {isLoading ? (
        <Spinner text="Loading health..." />
      ) : error ? (
        <p className="u-text--muted">Health information is unavailable.</p>
      ) : backendNames.length === 0 ? (
        <p className="u-text--muted">No backend health information reported.</p>
      ) : (
        <MainTable headers={headers} rows={rows} responsive />
      )}
    </div>
  );
};

export default LoadBalancerHealthPanel;
