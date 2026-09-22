import type { FC } from "react";
import { Icon, MainTable } from "@canonical/react-components";
import ResourceLink from "components/ResourceLink";
import InstanceStatusIcon from "pages/instances/InstanceStatusIcon";
import InstanceIps from "pages/instances/InstanceIps";
import { ROOT_PATH } from "util/rootPath";
import type { ClusterNode } from "util/k8s/clusterNodes";

interface Props {
  nodes: ClusterNode[];
  project: string | null;
  emptyMessage: string;
  /** Load balancers have no Kubernetes node. */
  showNode?: boolean;
}

// First line of CAPI's bullet-list condition message.
const firstLine = (message: string): string =>
  message.split("\n")[0].replace(/^\s*\*\s*/, "");

const NodeReadiness: FC<{ node: ClusterNode }> = ({ node }) => {
  if (!node.machine) return <span className="u-text--muted">-</span>;
  const { ready, message, phase } = node.machine;
  return (
    <span title={message}>
      <Icon
        name={ready ? "status-succeeded-small" : "status-in-progress-small"}
        className="status-icon"
      />
      {ready ? "Ready" : "Not ready"}
      {!ready && message ? (
        <div className="u-text--muted p-text--small u-no-margin--bottom u-truncate">
          {firstLine(message)}
        </div>
      ) : null}
      {!ready && !message ? (
        <div className="u-text--muted p-text--small u-no-margin--bottom">
          {phase}
        </div>
      ) : null}
    </span>
  );
};

// Nodes of one role, each linking to its Incus instance page.
const ClusterNodeTable: FC<Props> = ({
  nodes,
  project,
  emptyMessage,
  showNode = true,
}) => {
  const headers = [
    { content: "Instance" },
    { content: "Instance status" },
    ...(showNode ? [{ content: "Kubernetes node" }] : []),
    { content: "IPv4" },
    ...(showNode ? [{ content: "Version" }] : []),
  ];

  const rows = nodes.map((node) => {
    const instanceProject = node.instance?.project ?? project;
    return {
      key: node.name,
      columns: [
        {
          content:
            node.instance && instanceProject ? (
              <ResourceLink
                type={
                  node.instance.type === "virtual-machine"
                    ? "virtual-machine"
                    : "container"
                }
                value={node.name}
                to={`${ROOT_PATH}/ui/project/${encodeURIComponent(instanceProject)}/instance/${encodeURIComponent(node.name)}`}
              />
            ) : (
              <span title="The instance does not exist yet">{node.name}</span>
            ),
        },
        {
          content: node.instance ? (
            <InstanceStatusIcon instance={node.instance} />
          ) : (
            <span className="u-text--muted">Provisioning</span>
          ),
        },
        ...(showNode ? [{ content: <NodeReadiness node={node} /> }] : []),
        {
          content: node.instance ? (
            <InstanceIps instance={node.instance} family="inet" />
          ) : (
            (node.machine?.address ?? "-")
          ),
        },
        ...(showNode ? [{ content: node.machine?.version ?? "-" }] : []),
      ],
    };
  });

  return (
    <MainTable
      headers={headers}
      rows={rows}
      responsive
      emptyStateMsg={emptyMessage}
    />
  );
};

export default ClusterNodeTable;
