import type { FC } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Col,
  CustomLayout,
  Icon,
  MainTable,
  Notification,
  Row,
  Spinner,
  useNotify,
} from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import BaseLayout from "components/BaseLayout";
import RenameHeader from "components/RenameHeader";
import NotificationRow from "components/NotificationRow";
import ResourceLink from "components/ResourceLink";
import { useAuth } from "context/auth";
import { fetchInstances } from "api/instances";
import { ROOT_PATH } from "util/rootPath";
import { groupClusterNodes } from "util/k8s/clusterNodes";
import ClusterStatusLabel from "pages/kubernetes/ClusterStatusLabel";
import ClusterNodeTable from "pages/kubernetes/ClusterNodeTable";
import DeleteClusterBtn from "pages/kubernetes/DeleteClusterBtn";
import ScaleClusterBtn from "pages/kubernetes/ScaleClusterBtn";
import UpgradeClusterBtn from "pages/kubernetes/UpgradeClusterBtn";
import ClusterActivity from "pages/kubernetes/ClusterActivity";
import ClusterMetalLB from "pages/kubernetes/ClusterMetalLB";
import { runningVersion } from "util/k8s/upgrade";
import { useNodeBootstrap } from "pages/kubernetes/useNodeBootstrap";
import ClusterKubeconfig from "pages/kubernetes/ClusterKubeconfig";
import { useK8sManagement } from "pages/kubernetes/useK8sManagement";
import {
  useK8sClusterStatus,
  useK8sClusters,
} from "pages/kubernetes/useK8sClusters";

const formatReady = (ready: number | null, desired: number): string =>
  ready === null ? String(desired) : `${String(ready)}/${String(desired)}`;

// Conditions whose "False" is the healthy state (CAPI v1beta2).
const NEGATIVE_POLARITY = new Set([
  "Paused",
  "Deleting",
  "RollingOut",
  "ScalingUp",
  "ScalingDown",
  "Remediating",
]);

const conditionHealthy = (type?: string, status?: string): boolean =>
  NEGATIVE_POLARITY.has(type ?? "") ? status !== "True" : status === "True";

const ClusterDetail: FC = () => {
  const { name = "" } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const { isFineGrained } = useAuth();
  const { info } = useK8sManagement();
  const agentReachable = info !== undefined;

  const { data: clusters = [], isLoading: clustersLoading } =
    useK8sClusters(agentReachable);
  const record = clusters.find((c) => c.name === name);
  const { data: status, error } = useK8sClusterStatus(name, agentReachable);
  const project = record?.project ?? null;

  // The cluster's Incus instances, tagged by CAPN (user.cluster-*).
  const { data: instances = [] } = useQuery({
    queryKey: ["k8s", "cluster-instances", project],
    queryFn: async () => fetchInstances(project, isFineGrained, false),
    enabled: project !== null && isFineGrained !== null,
    refetchInterval: 5000,
  });

  if (error) {
    notify.failure("Loading cluster status failed", error);
  }

  const nodes = groupClusterNodes(name, instances, status?.machines ?? []);
  const bootstrap = useNodeBootstrap(
    [...nodes.controlPlane, ...nodes.workers],
    project,
  );
  const failedNodes = [...bootstrap.entries()].filter(
    ([, diagnosis]) => diagnosis.state === "failed",
  );
  const backToList = () => {
    navigate(`${ROOT_PATH}/ui/kubernetes`);
  };

  if (!record) {
    return (
      <BaseLayout title={name}>
        {clustersLoading || !agentReachable ? (
          <Spinner className="u-loader" text="Loading cluster..." />
        ) : (
          <Notification severity="negative" title="Cluster not found">
            No cluster named <strong>{name}</strong> is managed by the
            Kubernetes agent.{" "}
            <Button appearance="link" dense onClick={backToList}>
              Back to clusters
            </Button>
          </Notification>
        )}
      </BaseLayout>
    );
  }

  const clusterStatus = status?.status ?? record.status;
  const targetVersion = status?.version ?? record.kubernetesVersion;
  const nodeVersion = runningVersion(status?.machines ?? []);
  const capabilities = info?.capabilities;

  return (
    <CustomLayout
      header={
        <RenameHeader
          name={name}
          parentItems={[
            <Link to={`${ROOT_PATH}/ui/kubernetes`} key="clusters">
              Kubernetes clusters
            </Link>,
          ]}
          isLoaded
          renameDisabledReason="Cannot rename Kubernetes clusters"
          controls={
            <>
              <ScaleClusterBtn
                name={name}
                controlPlaneCount={record.controlPlaneCount}
                workerCount={record.workerCount}
              />
              <UpgradeClusterBtn
                name={name}
                version={targetVersion}
                status={clusterStatus}
                supported={capabilities?.upgrade === true}
              />
              <DeleteClusterBtn
                name={name}
                withLabel
                onConfirmed={backToList}
              />
            </>
          }
        />
      }
      contentClassName="detail-page k8s-cluster-detail"
    >
      <NotificationRow />
      {failedNodes.length > 0 ? (
        <Notification
          severity="negative"
          title={
            failedNodes.length === 1
              ? "A node failed to bootstrap"
              : `${failedNodes.length} nodes failed to bootstrap`
          }
        >
          <p className="u-no-margin--bottom">
            kubeadm stopped with an error and will not retry. Fix the cause and
            recreate the cluster (or scale the affected node group).
          </p>
          {failedNodes.map(([nodeName, diagnosis]) => (
            <details key={nodeName} className="k8s-bootstrap-failure">
              <summary>
                <strong>{nodeName}</strong>: {diagnosis.reason}
              </summary>
              {diagnosis.logTail ? (
                <pre className="u-no-margin--bottom k8s-condition-message">
                  {diagnosis.logTail}
                </pre>
              ) : null}
            </details>
          ))}
        </Notification>
      ) : null}
      {status?.problem ? (
        <Notification severity="negative" title="This cluster will not come up">
          <p className="u-no-margin--bottom">{status.problem}</p>
        </Notification>
      ) : null}
      {status?.message ? (
        <Notification severity="caution" title="Not available yet">
          <pre className="u-no-margin--bottom k8s-condition-message">
            {status.message}
          </pre>
        </Notification>
      ) : null}

      <Row className="general">
        <Col size={3}>
          <h2 className="p-heading--5">General</h2>
        </Col>
        <Col size={7}>
          <table>
            <tbody>
              <tr>
                <th className="u-text--muted">Status</th>
                <td>
                  <ClusterStatusLabel status={clusterStatus} />
                  {status?.phase ? (
                    <span className="u-text--muted"> · {status.phase}</span>
                  ) : null}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Kubernetes version</th>
                <td>
                  {nodeVersion && nodeVersion !== targetVersion ? (
                    <>
                      {nodeVersion} → {targetVersion}
                      <span className="u-text--muted">
                        {" "}
                        · nodes are being replaced
                      </span>
                    </>
                  ) : (
                    targetVersion
                  )}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">API endpoint</th>
                <td>
                  {status?.endpoint ? <code>{status.endpoint}</code> : "-"}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Project</th>
                <td>
                  {project ? (
                    <ResourceLink
                      type="project"
                      value={project}
                      to={`${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/instances`}
                    />
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Control plane ready</th>
                <td>
                  {formatReady(
                    status?.controlPlane.ready ?? null,
                    record.controlPlaneCount,
                  )}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Workers ready</th>
                <td>
                  {formatReady(
                    status?.workers.ready ?? null,
                    record.workerCount,
                  )}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Created</th>
                <td>{new Date(record.createdAt).toLocaleString()}</td>
              </tr>
              {status?.source === "cache" ? (
                <tr>
                  <th className="u-text--muted">Status source</th>
                  <td>
                    Cached — the management cluster is not reachable right now
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Col>
      </Row>

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">Kubeconfig</h2>
        </Col>
        <Col size={9}>
          <ClusterKubeconfig name={name} endpoint={status?.endpoint} />
        </Col>
      </Row>

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">
            Control plane ({nodes.controlPlane.length})
          </h2>
        </Col>
        <Col size={9}>
          <ClusterNodeTable
            nodes={nodes.controlPlane}
            project={project}
            bootstrap={bootstrap}
            emptyMessage="No control plane nodes yet."
          />
        </Col>
      </Row>

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">Workers ({nodes.workers.length})</h2>
        </Col>
        <Col size={9}>
          <ClusterNodeTable
            nodes={nodes.workers}
            project={project}
            bootstrap={bootstrap}
            emptyMessage="No worker nodes."
          />
        </Col>
      </Row>

      {nodes.loadBalancers.length > 0 ? (
        <Row>
          <Col size={3}>
            <h2 className="p-heading--5">Load balancer</h2>
          </Col>
          <Col size={9}>
            <ClusterNodeTable
              nodes={nodes.loadBalancers}
              project={project}
              emptyMessage="No load balancer."
              showNode={false}
            />
          </Col>
        </Row>
      ) : null}

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">Load balancer services</h2>
        </Col>
        <Col size={9}>
          <ClusterMetalLB
            name={name}
            supported={capabilities?.metallb === true}
          />
        </Col>
      </Row>

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">Activity</h2>
        </Col>
        <Col size={9}>
          <ClusterActivity
            name={name}
            status={clusterStatus}
            supported={capabilities?.activity === true}
          />
        </Col>
      </Row>

      {status && status.conditions.length > 0 ? (
        <Row>
          <Col size={3}>
            <h2 className="p-heading--5">Conditions</h2>
          </Col>
          <Col size={9}>
            <MainTable
              responsive
              headers={[
                { content: "Condition" },
                { content: "Status" },
                { content: "Reason" },
              ]}
              rows={status.conditions.map((c) => ({
                key: c.type,
                columns: [
                  { content: c.type ?? "-" },
                  {
                    content: (
                      <>
                        <Icon
                          name={
                            conditionHealthy(c.type, c.status)
                              ? "status-succeeded-small"
                              : "status-in-progress-small"
                          }
                          className="status-icon"
                        />
                        {c.status ?? "-"}
                      </>
                    ),
                  },
                  {
                    content: <span title={c.message}>{c.reason ?? "-"}</span>,
                  },
                ],
              }))}
            />
          </Col>
        </Row>
      ) : null}
    </CustomLayout>
  );
};

export default ClusterDetail;
