import type { FC } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Button,
  List,
  MainTable,
  Notification,
  Row,
  ScrollableTable,
  Spinner,
  TablePagination,
  useNotify,
} from "@canonical/react-components";
import BaseLayout from "components/BaseLayout";
import ResourceLink from "components/ResourceLink";
import ClusterStatusLabel from "pages/kubernetes/ClusterStatusLabel";
import DeleteClusterBtn from "pages/kubernetes/DeleteClusterBtn";
import NotificationRow from "components/NotificationRow";
import useSortTableData from "util/useSortTableData";
import { ROOT_PATH } from "util/rootPath";
import { useK8sManagement } from "pages/kubernetes/useK8sManagement";
import type { ManagementStage } from "util/k8s/management";
import {
  useDeletingClusters,
  useK8sClusters,
  type K8sClusterRecord,
} from "pages/kubernetes/useK8sClusters";

// Show "ready/desired" once the agent has a live count from the CRDs, otherwise
// just the desired count from the cache.
const formatReady = (ready: number | undefined, desired: number): string =>
  ready === undefined ? String(desired) : `${String(ready)}/${String(desired)}`;

// Stages that are transient or fine on their own get no notice on this page.
const QUIET_STAGES: ManagementStage[] = ["loading", "connecting", "ready"];

// CAPI's Available message is a bullet list; the first line names the blocker.
const firstLine = (message: string): string =>
  message.split("\n")[0].replace(/^\*\s*/, "");

const clusterUrl = (name: string): string =>
  `${ROOT_PATH}/ui/kubernetes/cluster/${encodeURIComponent(name)}`;

const ClusterList: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const { state: management, config, info } = useK8sManagement();
  const managementReady = management.stage === "ready";
  const {
    data: clusters = [],
    error,
    isLoading,
  } = useK8sClusters(info !== undefined);

  if (error) {
    notify.failure("Loading Kubernetes clusters failed", error);
  }

  const headers = [
    { content: "Name", sortKey: "name" },
    { content: "Status", sortKey: "status" },
    { content: "Kubernetes version", sortKey: "version" },
    { content: "Control plane", className: "u-align--right", sortKey: "cp" },
    { content: "Workers", className: "u-align--right", sortKey: "workers" },
    { content: "API endpoint" },
    { content: "Project", sortKey: "project" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const deleting = useDeletingClusters();

  const rows = clusters.map((cluster: K8sClusterRecord) => {
    const isDeleting = deleting.has(cluster.name);
    const status = isDeleting ? "deleting" : cluster.status;
    return {
      key: cluster.id,
      name: cluster.name,
      columns: [
        {
          content: <Link to={clusterUrl(cluster.name)}>{cluster.name}</Link>,
        },
        {
          content: (
            <>
              <ClusterStatusLabel status={status} />
              {cluster.phase && !isDeleting ? (
                <div className="u-text--muted p-text--small u-no-margin--bottom">
                  {cluster.phase}
                </div>
              ) : null}
              {cluster.message && !isDeleting ? (
                <div
                  className="u-text--muted p-text--small u-no-margin--bottom u-truncate"
                  title={cluster.message}
                >
                  {firstLine(cluster.message)}
                </div>
              ) : null}
            </>
          ),
        },
        { content: cluster.kubernetesVersion },
        {
          content: formatReady(
            cluster.controlPlaneReady,
            cluster.controlPlaneCount,
          ),
          className: "u-align--right",
        },
        {
          content: formatReady(cluster.workerReady, cluster.workerCount),
          className: "u-align--right",
        },
        {
          content: cluster.endpoint ? (
            <code className="u-truncate" title={cluster.endpoint}>
              {cluster.endpoint.replace(/^https:\/\//, "")}
            </code>
          ) : (
            "-"
          ),
        },
        {
          content: cluster.project ? (
            <ResourceLink
              type="project"
              value={cluster.project}
              to={`${ROOT_PATH}/ui/project/${encodeURIComponent(cluster.project)}/instances`}
            />
          ) : (
            "-"
          ),
        },
        {
          content: (
            <List
              inline
              className="actions-list u-no-margin--bottom"
              items={[<DeleteClusterBtn name={cluster.name} key="delete" />]}
            />
          ),
          className: "u-align--right actions",
        },
      ],
      sortData: {
        name: cluster.name.toLowerCase(),
        status,
        version: cluster.kubernetesVersion.toLowerCase(),
        cp: cluster.controlPlaneCount,
        workers: cluster.workerCount,
        project: (cluster.project ?? "").toLowerCase(),
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  return (
    <BaseLayout
      mainClassName="cluster-list"
      title="Kubernetes clusters"
      controls={
        <>
          <Button
            appearance="base"
            onClick={() => {
              navigate(`${ROOT_PATH}/ui/kubernetes/settings`);
            }}
          >
            Kubernetes settings
          </Button>
          <Button
            appearance="positive"
            disabled={!managementReady}
            title={managementReady ? undefined : management.title}
            onClick={() => {
              navigate(`${ROOT_PATH}/ui/kubernetes/create`);
            }}
          >
            Create cluster
          </Button>
        </>
      }
    >
      <NotificationRow />
      {!QUIET_STAGES.includes(management.stage) ? (
        <Notification severity={management.severity} title={management.title}>
          {management.message}{" "}
          {management.stage === "agent-unreachable" && config.url ? (
            <>
              <a href={config.url} target="_blank" rel="noreferrer">
                Approve K8s manager certificate
              </a>{" "}
              ·{" "}
            </>
          ) : null}
          <Button
            appearance="link"
            dense
            onClick={() => {
              navigate(
                `${ROOT_PATH}/ui/kubernetes/settings/management-appliance`,
              );
            }}
          >
            Management appliance
          </Button>
        </Notification>
      ) : null}
      <Row>
        <ScrollableTable
          dependencies={[clusters, notify.notification]}
          tableId="k8s-cluster-table"
          belowIds={["status-bar"]}
        >
          <TablePagination
            data={sortedRows}
            id="pagination"
            itemName="cluster"
            className="u-no-margin--top"
            aria-label="Table pagination control"
          >
            <MainTable
              id="k8s-cluster-table"
              headers={headers}
              sortable
              responsive
              onUpdateSort={updateSort}
              emptyStateMsg={
                isLoading ? (
                  <Spinner className="u-loader" text="Loading clusters..." />
                ) : (
                  "No Kubernetes clusters yet."
                )
              }
            />
          </TablePagination>
        </ScrollableTable>
      </Row>
    </BaseLayout>
  );
};

export default ClusterList;
