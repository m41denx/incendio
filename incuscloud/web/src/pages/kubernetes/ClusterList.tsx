import type { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { List, MainTable, Row, ScrollableTable, Spinner, TablePagination, useNotify } from "@canonical/react-components";
import NotificationRow from "@incendio/ui/components/NotificationRow";
import useSortTableData from "@incendio/ui/util/useSortTableData";
import PageLayout from "../../components/PageLayout";
import EmptyList from "../../components/EmptyList";
import { can, useMe } from "../../api/hooks";
import type { K8sCluster } from "../../api/types";
import ClusterStatusLabel from "./ClusterStatusLabel";
import DeleteClusterBtn from "./DeleteClusterBtn";
import { busy, canDelete, clusterUrl, useK8sClusters, useK8sOptions } from "./useK8sClusters";

// Incendio's (pages/kubernetes/ClusterList.tsx) over IncusCloud's API: its
// columns, with Tenant and Incus cluster in place of Project, and filters by
// Incus cluster (?cluster=) and tenant (?tenant=).

// CAPI's Available message is a bullet list; the first line names the blocker.
const firstLine = (message: string): string => message.split("\n")[0]!.replace(/^\*\s*/, "");

const ClusterList: FC = () => {
  const notify = useNotify();
  const [params] = useSearchParams();
  const filters = { cluster: params.get("cluster") ?? undefined, tenant: params.get("tenant") ?? undefined };
  const { data: me } = useMe();
  const options = useK8sOptions();
  const enabled = options.data?.enabled === true;
  const { data: clusters = [], error, isLoading } = useK8sClusters(filters);
  const canCreate = enabled && (can(me, "operator") || !!me?.tenants.some((t) => t.role !== "viewer"));
  const query = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => !!e[1])).toString();

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
    { content: "Tenant", sortKey: "tenant" },
    { content: "Incus cluster", sortKey: "cluster" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = clusters.map((cluster: K8sCluster) => ({
    key: cluster.id,
    name: cluster.name,
    columns: [
      { content: <Link to={clusterUrl(cluster.id)}>{cluster.name}</Link> },
      {
        content: (
          <>
            <ClusterStatusLabel status={cluster.status} />
            {cluster.statusMessage ? (
              <div className="u-text--muted p-text--small u-no-margin--bottom u-truncate" title={cluster.statusMessage}>
                {firstLine(cluster.statusMessage)}
              </div>
            ) : null}
          </>
        ),
      },
      { content: cluster.version },
      { content: String(cluster.controlPlanes), className: "u-align--right" },
      { content: String(cluster.workers), className: "u-align--right" },
      {
        content: (
          <code className="u-truncate" title={cluster.endpoint}>
            {cluster.endpoint.replace(/^https:\/\//, "")}
          </code>
        ),
      },
      { content: <Link to={`/tenants/${cluster.tenantId}`}>{cluster.tenantSlug}</Link> },
      { content: <Link to={`/inventory/${encodeURIComponent(cluster.clusterName)}`}>{cluster.clusterName}</Link> },
      {
        content: canDelete(me, cluster.tenantId) ? (
          <List inline className="actions-list u-no-margin--bottom" items={[<DeleteClusterBtn id={cluster.id} name={cluster.name} disabled={busy(cluster)} key="delete" />]} />
        ) : null,
        className: "u-align--right actions",
      },
    ],
    sortData: {
      name: cluster.name.toLowerCase(),
      status: cluster.status,
      version: cluster.version.toLowerCase(),
      cp: cluster.controlPlanes,
      workers: cluster.workers,
      tenant: cluster.tenantSlug,
      cluster: cluster.clusterName,
    },
  }));

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  return (
    <PageLayout
      title="Kubernetes clusters"
      controls={
        canCreate ? (
          <Link className="p-button--positive u-no-margin--bottom" to={`/kubernetes/new${query ? `?${query}` : ""}`}>
            Create cluster
          </Link>
        ) : undefined
      }
    >
      <NotificationRow />
      {options.data && !enabled ? (
        <EmptyList icon="kubernetes" title="Kubernetes is not enabled">
          IncusCloud has no management cluster. An administrator turns Kubernetes on by giving IncusCloud a kubeconfig for one (IC_K8S_KUBECONFIG).
        </EmptyList>
      ) : (
        <Row>
          <ScrollableTable dependencies={[clusters, notify.notification]} tableId="k8s-cluster-table" belowIds={["status-bar"]}>
            <TablePagination data={sortedRows} id="pagination" itemName="cluster" className="u-no-margin--top" aria-label="Table pagination control">
              <MainTable
                id="k8s-cluster-table"
                headers={headers}
                sortable
                responsive
                onUpdateSort={updateSort}
                emptyStateMsg={
                  isLoading || options.isPending ? (
                    <Spinner className="u-loader" text="Loading clusters..." />
                  ) : (
                    "No Kubernetes clusters yet. A Kubernetes cluster runs on any Incus cluster your tenant is placed on, and its nodes count against the tenant's quota."
                  )
                }
              />
            </TablePagination>
          </ScrollableTable>
        </Row>
      )}
    </PageLayout>
  );
};

export default ClusterList;
