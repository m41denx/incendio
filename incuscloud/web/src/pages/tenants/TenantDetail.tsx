import { type FC, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Input, MainTable } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { Tenant, TenantPlacement } from "../../api/types";
import ClusterStatus from "../clusters/ClusterStatus";
import Members from "./Members";
import { QUOTA_FIELDS, QuotaFields, type QuotaDraft, draftOf, draftValid, quotasOf } from "./quotas";
import { roleName } from "./roles";

const TenantDetail: FC = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tenant = useQuery({ queryKey: ["tenants", id], queryFn: () => request<Tenant>("GET", `/api/v1/tenants/${id}`) });
  const placements = useQuery({ queryKey: ["tenants", id, "placements"], queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${id}/placements`) });
  const [error, setError] = useState<unknown>(null);
  const [editingQuotas, setEditingQuotas] = useState(false);
  const [quotas, setQuotas] = useState<QuotaDraft>(draftOf({}));
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  const role = tenantRole(me, id);
  const platformAdmin = can(me, "admin");
  const canManage = platformAdmin || role === "owner" || role === "admin";
  const ownerPower = platformAdmin || role === "owner";
  const patch = async (body: Partial<Pick<Tenant, "name" | "quotas">>) => {
    const t = await request<Tenant>("PATCH", `/api/v1/tenants/${id}`, body);
    qc.setQueryData(["tenants", id], t);
    await qc.invalidateQueries({ queryKey: ["tenants"], exact: true });
  };

  return (
    <PageLayout
      title={
        <>
          <Link to="/tenants">Tenants</Link> / {tenant.data?.name ?? "…"}
        </>
      }
      controls={
        canManage ? (
          <>
            <Link className="p-button" to={`/service-accounts?tenant=${id}`}>
              Service accounts
            </Link>
            <Link className="p-button" to={`/audit?tenant=${id}`}>
              Audit log
            </Link>
          </>
        ) : undefined
      }
    >
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      <Loaded query={tenant}>
        {(t) => (
          <>
            <KeyValues
              items={[
                ["Slug", <span className="ic-mono">{t.slug}</span>],
                ["Your role", role ? roleName(role) : me?.platformRole ? `Platform ${me.platformRole}` : "—"],
                ["Created", new Date(t.createdAt).toLocaleDateString()],
              ]}
            />
            <h2 className="p-heading--4">Quotas</h2>
            <KeyValues items={QUOTA_FIELDS.map((f) => [f.label, t.quotas[f.key]?.toString() ?? "No limit"])} />
            {can(me, "operator") ? (
              <Button
                onClick={() => {
                  setQuotas(draftOf(t.quotas));
                  setEditingQuotas(true);
                }}
              >
                Edit quotas
              </Button>
            ) : null}

            <h2 className="p-heading--4">Where it runs</h2>
            <Loaded query={placements}>
              {(list) => (
                <MainTable
                  emptyStateMsg="Not placed on any cluster yet. Platform operators place tenants from a cluster's page."
                  headers={[{ content: "Cluster" }, { content: "Project" }, { content: "Status" }, { content: "Since" }]}
                  rows={list.map((p) => ({
                    key: p.clusterId,
                    columns: [
                      { content: <Link to={`/clusters/${p.clusterId}`}>{p.clusterName}</Link> },
                      { content: <span className="ic-mono">{p.project}</span> },
                      { content: <ClusterStatus status={p.status} message={p.statusMessage} /> },
                      { content: new Date(p.createdAt).toLocaleDateString() },
                    ],
                  }))}
                />
              )}
            </Loaded>

            <Members tenant={t} canManage={canManage} ownerPower={ownerPower} />

            {canManage ? (
              <>
                <h2 className="p-heading--4">Administration</h2>
                <div className="ic-page-controls">
                  <Button
                    onClick={() => {
                      setName(t.name);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </Button>
                  {ownerPower ? (
                    <ConfirmAction
                      label="Delete tenant"
                      title={`Delete ${t.slug}?`}
                      onConfirm={async () => {
                        await request("DELETE", `/api/v1/tenants/${id}`);
                        await qc.invalidateQueries({ queryKey: ["tenants"] });
                        navigate("/tenants");
                      }}
                      onError={setError}
                    >
                      <p>Its members, service accounts and their credentials are removed. A tenant still placed on clusters cannot be deleted.</p>
                    </ConfirmAction>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        )}
      </Loaded>
      {editingQuotas ? (
        <FormModal title="Edit quotas" submitLabel="Save" onClose={() => setEditingQuotas(false)} onSubmit={() => patch({ quotas: quotasOf(quotas) })} submitDisabled={!draftValid(quotas)}>
          <QuotaFields value={quotas} onChange={setQuotas} />
        </FormModal>
      ) : null}
      {renaming ? (
        <FormModal title="Rename tenant" submitLabel="Save" onClose={() => setRenaming(false)} onSubmit={() => patch({ name })} submitDisabled={!name.trim()}>
          <Input id="rename-tenant" label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </FormModal>
      ) : null}
    </PageLayout>
  );
};

export default TenantDetail;
