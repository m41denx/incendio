import { type FC, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, MainTable } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import ConfirmAction from "../../components/ConfirmAction";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { ServiceAccount, ServiceAccountSecret } from "../../api/types";
import CreateServiceAccount, { canCreate, tenantsQuery } from "./CreateServiceAccount";
import SecretOnce from "./SecretOnce";
import EmptyList from "../../components/EmptyList";

const ServiceAccountList: FC = () => {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const tenantFilter = params.get("tenant") ?? "";
  const accounts = useQuery({ queryKey: ["service-accounts"], queryFn: () => request<ServiceAccount[]>("GET", "/api/v1/service-accounts") });
  const tenants = useQuery(tenantsQuery);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<ServiceAccountSecret | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Tenant accounts: their tenant's owners/admins and platform admins; platform accounts: platform admins.
  const manages = (a: ServiceAccount) => can(me, "admin") || (!!a.tenantId && ["owner", "admin"].includes(tenantRole(me, a.tenantId) ?? ""));
  const slugOf = (id: string) => tenants.data?.find((t) => t.id === id)?.slug ?? me?.tenants.find((t) => t.id === id)?.slug ?? id;

  const rotate = async (a: ServiceAccount) => {
    setError(null);
    setSecret(await request<ServiceAccountSecret>("POST", `/api/v1/service-accounts/${a.id}/rotate`));
  };

  const remove = async (a: ServiceAccount) => {
    setError(null);
    await request("DELETE", `/api/v1/service-accounts/${a.id}`);
    await qc.invalidateQueries({ queryKey: ["service-accounts"] });
  };

  return (
    <PageLayout
      title="Service accounts"
      controls={
        canCreate(me) ? (
          <Button appearance="positive" onClick={() => setCreating(true)}>
            Create service account
          </Button>
        ) : undefined
      }
    >
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      {tenantFilter ? (
        <p>
          Showing the accounts of tenant <strong>{slugOf(tenantFilter)}</strong>. <Link to="/service-accounts">Show all</Link>
        </p>
      ) : null}
      <Loaded query={accounts}>
        {(list) => {
          const rows = tenantFilter ? list.filter((a) => a.tenantId === tenantFilter) : list;
          return (
            rows.length === 0 ? (
              <EmptyList icon="applications" title="No service accounts found">{tenantFilter ? "No service accounts in this tenant yet." : "No service accounts yet."}</EmptyList>
            ) : (
            <MainTable
              sortable
              headers={[
                { content: "Name", sortKey: "name" },
                { content: "Client ID" },
                { content: "Scope", sortKey: "scope" },
                { content: "Created", sortKey: "created" },
                { content: "" },
              ]}
              rows={rows.map((a) => {
                const scope = a.tenantId ? `Tenant ${slugOf(a.tenantId)}` : `Platform ${a.platformRole ?? ""}`.trim();
                return {
                  key: a.id,
                  columns: [
                    { content: a.name },
                    { content: a.clientId, className: "mono-font" },
                    { content: scope },
                    { content: ago(a.createdAt) },
                    {
                      content: manages(a) ? (
                        <div className="ic-actions">
                          <ConfirmAction
                            label="Rotate secret"
                            appearance="base"
                            title={`Rotate the secret for ${a.name}?`}
                            onConfirm={() => rotate(a)}
                            onError={setError}
                          >
                            <p>The current secret stops working at once. Update anything that uses it with the new one.</p>
                          </ConfirmAction>
                          <ConfirmAction label="Delete" title={`Delete ${a.name}?`} onConfirm={() => remove(a)} onError={setError}>
                            <p>Anything that signs in with this account stops working at once. This cannot be undone.</p>
                          </ConfirmAction>
                        </div>
                      ) : null,
                    },
                  ],
                  sortData: { name: a.name.toLowerCase(), scope, created: a.createdAt },
                };
              })}
            />
            )
          );
        }}
      </Loaded>
      {creating ? (
        <CreateServiceAccount tenant={tenantFilter} onCreated={(s) => setSecret(s)} onClose={() => setCreating(false)} />
      ) : null}
      {secret ? <SecretOnce secret={secret} onDone={() => setSecret(null)} /> : null}
    </PageLayout>
  );
};

export default ServiceAccountList;
