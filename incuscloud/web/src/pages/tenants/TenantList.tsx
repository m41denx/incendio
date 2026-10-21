import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { Button, MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { Loaded } from "../../components/Status";
import { request } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { Tenant } from "../../api/types";
import CreateTenant from "./CreateTenant";
import { quotaSummary } from "./quotas";
import { roleName } from "./roles";
import EmptyList from "../../components/EmptyList";

const TenantList: FC = () => {
  const { data: me } = useMe();
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants") });
  const [creating, setCreating] = useState(false);
  return (
    <PageLayout
      title="Tenants"
      controls={
        can(me, "operator") ? (
          <Button appearance="positive" onClick={() => setCreating(true)}>
            Create tenant
          </Button>
        ) : undefined
      }
    >
      <Loaded query={tenants}>
        {(list) =>
          list.length === 0 ? (
            <EmptyList icon="switcher-environments" title="No tenants found">{can(me, "operator") ? "No tenants yet." : "You are not a member of any tenant yet. Ask a tenant owner to add you."}</EmptyList>
          ) : (
          <MainTable
            sortable
            headers={[{ content: "Slug", sortKey: "slug" }, { content: "Name", sortKey: "name" }, { content: "Quotas" }, { content: "Your role", sortKey: "role" }]}
            rows={list.map((t) => {
              const role = tenantRole(me, t.id);
              return {
                key: t.id,
                columns: [{ content: <Link to={`/tenants/${t.id}`}>{t.slug}</Link> }, { content: t.name }, { content: quotaSummary(t.quotas) }, { content: role ? roleName(role) : "—" }],
                sortData: { slug: t.slug, name: t.name.toLowerCase(), role: role ?? "" },
              };
            })}
          />
        )}
      </Loaded>
      {creating ? <CreateTenant onClose={() => setCreating(false)} /> : null}
    </PageLayout>
  );
};

export default TenantList;
