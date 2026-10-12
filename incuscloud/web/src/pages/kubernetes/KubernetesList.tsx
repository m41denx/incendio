import type { FC } from "react";
import { Link } from "react-router-dom";
import { MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import EmptyList from "../../components/EmptyList";
import { Loaded } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { K8sCluster } from "../../api/types";
import K8sStatus, { busy } from "./K8sStatus";
import { useK8sOptions } from "./hooks";
import { projectPath } from "../../console/object";
import { clusterOf, nameOf } from "../inventory/tree";

/** While something is being created or deleted, the list follows it. */
const POLL_MS = 5_000;

/** Where a Kubernetes cluster's page is: in its tenant's project on its Incus cluster. */
export const k8sPath = (k: Pick<K8sCluster, "project" | "clusterName" | "name">) => projectPath(`${k.project}@${k.clusterName}`, `kubernetes/${encodeURIComponent(k.name)}`);

/** Which ones a list shows: every cluster's, one Incus cluster's, or one project's (`p@cluster`). */
export interface K8sScope {
  cluster?: string;
  project?: string;
}

/** The Kubernetes clusters the caller may see (P10), laid out like Incendio's; within one Incus cluster or project when scoped. */
const KubernetesList: FC<{ scope?: K8sScope }> = ({ scope = {} }) => {
  const { data: me } = useMe();
  const options = useK8sOptions();
  const enabled = options.data?.enabled === true;
  const clusters = useQuery({
    queryKey: ["kubernetes"],
    queryFn: () => request<K8sCluster[]>("GET", "/api/v1/kubernetes"),
    enabled,
    refetchInterval: (q) => (q.state.data?.some(busy) ? POLL_MS : false),
  });
  const canCreate = can(me, "operator") || !!me?.tenants.some((t) => t.role !== "viewer");
  const cluster = scope.cluster ?? (scope.project ? clusterOf(scope.project) : undefined);
  const shown = (list: K8sCluster[]) =>
    list.filter((k) => (!cluster || k.clusterName === cluster) && (!scope.project || `${k.project}@${k.clusterName}` === scope.project));
  const createTo = cluster ? `/kubernetes/new?cluster=${encodeURIComponent(cluster)}` : "/kubernetes/new";

  return (
    <PageLayout
      title="Kubernetes clusters"
      controls={
        enabled && canCreate ? (
          <Link className="p-button--positive" to={createTo}>
            Create cluster
          </Link>
        ) : undefined
      }
    >
      <Loaded query={options}>
        {(o) =>
          !o.enabled ? (
            <EmptyList icon="kubernetes" title="Kubernetes is not enabled">
              IncusCloud has no management cluster. An administrator turns Kubernetes on by giving IncusCloud a kubeconfig for one (IC_K8S_KUBECONFIG).
            </EmptyList>
          ) : (
            <Loaded query={clusters}>
              {(all) => {
                const list = shown(all);
                return list.length === 0 ? (
                  <EmptyList icon="kubernetes" title="No Kubernetes clusters">
                    {cluster
                      ? `None on ${scope.project ? nameOf(scope.project) : cluster} yet. A Kubernetes cluster's nodes are instances in its tenant's project, and count against the tenant's quota.`
                      : "A Kubernetes cluster runs on any Incus cluster your tenant is placed on, and its nodes count against the tenant's quota."}
                  </EmptyList>
                ) : (
                  <MainTable
                    headers={[
                      { content: "Name" },
                      { content: "Status" },
                      { content: "Version" },
                      { content: "Nodes ready", className: "u-align--right" },
                      { content: "Control plane", className: "u-align--right" },
                      { content: "Workers", className: "u-align--right" },
                      { content: "API endpoint" },
                      ...(scope.project ? [] : [{ content: "Tenant" }]),
                      ...(cluster ? [] : [{ content: "Incus cluster" }]),
                      { content: "Member" },
                    ]}
                    rows={list.map((k) => ({
                      key: k.id,
                      columns: [
                        { content: <Link to={k8sPath(k)}>{k.name}</Link> },
                        {
                          content: (
                            <>
                              <K8sStatus status={k.status} />
                              {k.statusMessage ? (
                                <div className="u-text--muted p-text--small u-no-margin--bottom u-truncate" title={k.statusMessage}>
                                  {k.statusMessage}
                                </div>
                              ) : null}
                            </>
                          ),
                        },
                        { content: k.version },
                        { content: `${k.nodesReady}/${k.controlPlanes + k.workers}`, className: "u-align--right" },
                        { content: k.controlPlanes, className: "u-align--right" },
                        { content: k.workers, className: "u-align--right" },
                        { content: <code className="u-truncate" title={k.endpoint}>{k.endpoint.replace(/^https:\/\//, "")}</code> },
                        ...(scope.project ? [] : [{ content: <Link to={`/tenants/${k.tenantId}`}>{k.tenantSlug}</Link> }]),
                        ...(cluster ? [] : [{ content: <Link to={`/inventory/${encodeURIComponent(k.clusterName)}`}>{k.clusterName}</Link> }]),
                        { content: k.member ? <Link to={`/ui/cluster/member/${encodeURIComponent(`${k.member}@${k.clusterName}`)}`}>{k.member}</Link> : "—" },
                      ],
                    }))}
                  />
                );
              }}
            </Loaded>
          )
        }
      </Loaded>
    </PageLayout>
  );
};

export default KubernetesList;
