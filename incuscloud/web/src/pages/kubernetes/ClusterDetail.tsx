import { type FC } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Col, CustomLayout, Icon, MainTable, Notification, Row } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import RenameHeader from "@incendio/ui/components/RenameHeader";
import ResourceLink from "@incendio/ui/components/ResourceLink";
import { groupClusterNodes } from "@incendio/ui/util/k8s/clusterNodes";
import { runningVersion } from "@incendio/ui/util/k8s/upgrade";
import type { LxdInstance } from "@incendio/ui/types/instance";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { incusAt } from "../../api/client";
import { useMe } from "../../api/hooks";
import { nameOf } from "../inventory/tree";
import ClusterStatusLabel from "./ClusterStatusLabel";
import ClusterNodeTable from "./ClusterNodeTable";
import DeleteClusterBtn from "./DeleteClusterBtn";
import ScaleClusterBtn from "./ScaleClusterBtn";
import UpgradeClusterBtn from "./UpgradeClusterBtn";
import ClusterActivity from "./ClusterActivity";
import ClusterMetalLB from "./ClusterMetalLB";
import ClusterKubeconfig from "./ClusterKubeconfig";
import { useK8sCluster, useK8sClusterStatus, useK8sNodes, canChange, canDelete, busy } from "./useK8sClusters";
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
  const {id = ""} = useParams();
  const navigate = useNavigate();
  const {data:me} = useMe();
  const cluster = useK8sCluster(id);
  const record = cluster.data;
  const statusQuery = useK8sClusterStatus(record ? id : "");
  const status = statusQuery.data;
  const machines = useK8sNodes(record ? id : "");
  const project = record ? `${record.project}@${record.clusterName}` : null;
  const instanceQuery = useQuery({queryKey:["kubernetes",id,"instances",project],
    queryFn: () => incusAt<LxdInstance[]>(record!.clusterName, `/1.0/instances?recursion=2&project=${encodeURIComponent(project!)}`), enabled:!!record, refetchInterval:5000});
  const instances = (instanceQuery.data ?? []).map(i => ({...i, name:nameOf(i.name), project:project!, location:nameOf(i.location ?? "")}));
  const nodes = groupClusterNodes(record?.name ?? "",instances,machines.data ?? []);
  const backToList = () => navigate("/kubernetes");
  if (cluster.error) return <PageLayout title="Kubernetes cluster"><ErrorMessage error={cluster.error} /></PageLayout>;
  if (!record) return <PageLayout title="Kubernetes cluster"><Loading /></PageLayout>;
  const name = record.name;
  const clusterStatus = record.status;
  const targetVersion = record.version;
  const nodeVersion = runningVersion(machines.data ?? []);
  const editable = canChange(me,record.tenantId) && !busy(record);
  return (
    <CustomLayout
      header={
        <RenameHeader
          name={name}
          parentItems={[
            <Link to={`/kubernetes`} key="clusters">
              Kubernetes clusters
            </Link>,
          ]}
          isLoaded
          renameDisabledReason="Cannot rename Kubernetes clusters"
          controls={
            <>
              {editable ? <><ScaleClusterBtn id={id} name={name} controlPlaneCount={record.controlPlanes} workerCount={record.workers} />
                <UpgradeClusterBtn id={id} name={name} version={targetVersion} status={clusterStatus} supported /></> : null}
              {canDelete(me,record.tenantId) ? <DeleteClusterBtn id={id} name={name} withLabel disabled={busy(record)} onConfirmed={backToList} /> : null}
            </>
          }
        />
      }
      contentClassName="detail-page k8s-cluster-detail"
    >
      {statusQuery.error ? <ErrorMessage error={statusQuery.error} title="Status unavailable" /> : null}
      {machines.error ? <ErrorMessage error={machines.error} title="Nodes unavailable" /> : null}
      {instanceQuery.error ? <ErrorMessage error={instanceQuery.error} title="Instances unavailable" /> : null}
      {record.status === "error" ? <Notification severity="negative" title="This cluster will not come up">{record.statusMessage}</Notification> : null}
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
                  {/* "Missing": CAPI has no Cluster yet, which is no news while IncusCloud is still creating it. */}
                  {status?.phase && !(status.phase === "Missing" && clusterStatus === "creating") ? (
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
                  {<code>{status?.endpoint || record.endpoint}</code>}
                </td>
              </tr>
              <tr><th className="u-text--muted">Tenant</th><td><Link to={`/tenants/${record.tenantId}`}>{record.tenantSlug}</Link></td></tr>
              <tr><th className="u-text--muted">Incus cluster</th><td><Link to={`/inventory/${encodeURIComponent(record.clusterName)}`}>{record.clusterName}</Link></td></tr>
              <tr>
                <th className="u-text--muted">Project</th>
                <td>
                  {project ? (
                    <ResourceLink
                      type="project"
                      value={project}
                      to={`/ui/project/${encodeURIComponent(project)}/instances`}
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
                    nodes.controlPlane.filter(n => n.machine?.ready).length,
                    record.controlPlanes,
                  )}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Workers ready</th>
                <td>
                  {formatReady(
                    nodes.workers.filter(n => n.machine?.ready).length,
                    record.workers,
                  )}
                </td>
              </tr>
              <tr>
                <th className="u-text--muted">Created</th>
                <td>{new Date(record.createdAt).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </Col>
      </Row>

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">Kubeconfig</h2>
        </Col>
        <Col size={9}>
          {canChange(me,record.tenantId) ? <ClusterKubeconfig key={id} id={id} name={name} endpoint={status?.endpoint || record.endpoint} /> : <p className="u-text--muted">Cluster-admin credentials are available to tenant members and up.</p>}
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
            emptyMessage="No worker nodes."
          />
        </Col>
      </Row>

      {["lxc","oci"].includes(record.spec.loadBalancer.type) ? (
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
          <ClusterMetalLB key={id} id={id} name={name} canEdit={editable} ready={record.status === "ready"} />
        </Col>
      </Row>

      <Row>
        <Col size={3}>
          <h2 className="p-heading--5">Activity</h2>
        </Col>
        <Col size={9}>
          <ClusterActivity id={id} status={clusterStatus} supported />
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
