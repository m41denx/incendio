import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  ConfirmationButton,
  Icon,
  List,
  MainTable,
  Notification,
  Row,
  ScrollableTable,
  Spinner,
  TablePagination,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import BaseLayout from "components/BaseLayout";
import NotificationRow from "components/NotificationRow";
import useSortTableData from "util/useSortTableData";
import { ROOT_PATH } from "util/rootPath";
import { useSettings } from "context/useSettings";
import { readApiConfig } from "util/k8s/appliance";
import {
  useDeleteK8sCluster,
  useK8sClusters,
  type K8sClusterRecord,
} from "pages/kubernetes/useK8sClusters";

const capitalize = (value: string): string =>
  value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;

interface DeleteProps {
  name: string;
}

const DeleteClusterBtn: FC<DeleteProps> = ({ name }) => {
  const toastNotify = useToastNotification();
  const deleteCluster = useDeleteK8sCluster();
  return (
    <ConfirmationButton
      appearance="base"
      loading={deleteCluster.isPending}
      confirmationModalProps={{
        title: "Confirm delete",
        children: (
          <p>
            This will permanently delete cluster <strong>{name}</strong> and
            tear down its Incus project.
          </p>
        ),
        confirmButtonLabel: "Delete",
        onConfirm: () => {
          deleteCluster.mutate(name, {
            onSuccess: () => {
              toastNotify.success(`Cluster "${name}" deleted.`);
            },
            onError: (error) => {
              toastNotify.failure("Cluster deletion failed", error);
            },
          });
        },
      }}
      disabled={deleteCluster.isPending}
      shiftClickEnabled
      showShiftClickHint
      title="Delete cluster"
      className="has-icon"
    >
      <Icon name="delete" />
    </ConfirmationButton>
  );
};

const ClusterList: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const { data: settings } = useSettings();
  const applianceCreated = readApiConfig(settings) !== null;
  const { data: clusters = [], error, isLoading } = useK8sClusters();

  if (error) {
    notify.failure("Loading Kubernetes clusters failed", error);
  }

  const headers = [
    { content: "Name", sortKey: "name" },
    { content: "Status", sortKey: "status" },
    { content: "Kubernetes version", sortKey: "version" },
    { content: "Control plane", className: "u-align--right", sortKey: "cp" },
    { content: "Workers", className: "u-align--right", sortKey: "workers" },
    { content: "Project", sortKey: "project" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = clusters.map((cluster: K8sClusterRecord) => ({
    key: cluster.id,
    name: cluster.name,
    columns: [
      { content: cluster.name },
      { content: capitalize(cluster.status) },
      { content: cluster.kubernetesVersion },
      { content: cluster.controlPlaneCount, className: "u-align--right" },
      { content: cluster.workerCount, className: "u-align--right" },
      { content: cluster.project ?? "-" },
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
      status: cluster.status.toLowerCase(),
      version: cluster.kubernetesVersion.toLowerCase(),
      cp: cluster.controlPlaneCount,
      workers: cluster.workerCount,
      project: (cluster.project ?? "").toLowerCase(),
    },
  }));

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
            disabled={!applianceCreated}
            title={
              applianceCreated
                ? undefined
                : "Create a management appliance in Kubernetes settings first"
            }
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
      {!applianceCreated ? (
        <Notification severity="caution" title="No management appliance">
          You need to create a Kubernetes management appliance before you can
          create clusters. Deploy it from{" "}
          <Button
            appearance="link"
            dense
            onClick={() => {
              navigate(
                `${ROOT_PATH}/ui/kubernetes/settings/management-appliance`,
              );
            }}
          >
            Kubernetes settings
          </Button>
          .
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
