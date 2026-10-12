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

/** While something is being created or deleted, the list follows it. */
const POLL_MS = 5_000;

/** The Kubernetes clusters of the caller's tenants (P10), laid out like Incendio's. */
const KubernetesList: FC = () => {
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

  return (
    <PageLayout
      title="Kubernetes clusters"
      controls={
        enabled && canCreate ? (
          <Link className="p-button--positive" to="/kubernetes/new">
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
              {(list) =>
                list.length === 0 ? (
                  <EmptyList icon="kubernetes" title="No Kubernetes clusters">
                    A Kubernetes cluster runs on any Incus cluster your tenant is placed on, and its nodes count against the tenant's quota.
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
                      { content: "Tenant" },
                      { content: "Incus cluster" },
                    ]}
                    rows={list.map((k) => ({
                      key: k.id,
                      columns: [
                        { content: <Link to={`/kubernetes/${k.id}`}>{k.name}</Link> },
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
                        { content: <Link to={`/tenants/${k.tenantId}`}>{k.tenantSlug}</Link> },
                        { content: <Link to={`/clusters/${k.clusterId}`}>{k.clusterName}</Link> },
                      ],
                    }))}
                  />
                )
              }
            </Loaded>
          )
        }
      </Loaded>
    </PageLayout>
  );
};

export default KubernetesList;
