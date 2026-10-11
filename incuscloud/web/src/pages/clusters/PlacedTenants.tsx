import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, MainTable, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ConfirmAction from "../../components/ConfirmAction";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import type { Cluster, Placement, Tenant } from "../../api/types";
import ClusterStatus from "./ClusterStatus";

/** Tenants on this cluster; operators place and remove them. */
const PlacedTenants: FC<{ cluster: Cluster; canManage: boolean }> = ({ cluster, canManage }) => {
  const qc = useQueryClient();
  const placements = useQuery({
    queryKey: ["clusters", cluster.id, "tenants"],
    queryFn: () => request<Placement[]>("GET", `/api/v1/clusters/${cluster.id}/tenants`),
    // Until the reconciler has created the projects.
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "pending") ? 2000 : false),
  });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"), enabled: canManage });
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["clusters", cluster.id] }), qc.invalidateQueries({ queryKey: ["tenants"] })]);

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("PUT", `/api/v1/clusters/${cluster.id}/tenants/${pick}`);
      setPick("");
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="p-heading--4">Tenants</h2>
      {error ? <ErrorMessage error={error} title="Not changed" /> : null}
      <Loaded query={placements}>
        {(list) => {
          const free = (tenants.data ?? []).filter((t) => !list.some((p) => p.tenantId === t.id));
          return (
            <>
              <MainTable
                emptyStateMsg="No tenants on this cluster."
                headers={[{ content: "Tenant" }, { content: "Project" }, { content: "Status" }, { content: "Placed" }, ...(canManage ? [{ content: "", className: "u-align--right" }] : [])]}
                rows={list.map((p) => ({
                  key: p.tenantId,
                  columns: [
                    { content: <Link to={`/tenants/${p.tenantId}`}>{p.slug}</Link> },
                    { content: <span className="ic-mono">{p.project}</span> },
                    { content: <ClusterStatus status={p.status} message={p.statusMessage} /> },
                    { content: new Date(p.createdAt).toLocaleDateString() },
                    ...(canManage
                      ? [
                          {
                            className: "u-align--right",
                            content: (
                              <ConfirmAction
                                label="Remove"
                                title={`Remove ${p.slug} from ${cluster.name}?`}
                                className="is-small u-no-margin--bottom"
                                onConfirm={async () => {
                                  await request("DELETE", `/api/v1/clusters/${cluster.id}/tenants/${p.tenantId}`);
                                  await refresh();
                                }}
                                onError={setError}
                              >
                                <p>
                                  Its members lose access on this cluster. The project <code>{p.project}</code> and its instances stay on the cluster.
                                </p>
                              </ConfirmAction>
                            ),
                          },
                        ]
                      : []),
                  ],
                }))}
              />
              {canManage && free.length ? (
                <div className="ic-page-controls" style={{ alignItems: "flex-end", maxWidth: "36rem" }}>
                  <Select
                    id="place-tenant"
                    label="Tenant"
                    wrapperClassName="u-no-margin--bottom"
                    style={{ flex: 1 }}
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    options={[{ value: "", label: "Choose a tenant", disabled: true }, ...free.map((t) => ({ value: t.id, label: t.slug }))]}
                  />
                  <ActionButton loading={busy} disabled={!pick || busy} onClick={place}>
                    Place
                  </ActionButton>
                </div>
              ) : null}
            </>
          );
        }}
      </Loaded>
    </>
  );
};

export default PlacedTenants;
