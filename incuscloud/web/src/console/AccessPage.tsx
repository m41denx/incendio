import type { FC } from "react";
import { Link } from "react-router-dom";
import { MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";
import { can, canAtRoot, useMe } from "../api/hooks";
import PageLayout from "../components/PageLayout";
import Section from "../components/Section";
import { Loaded } from "../components/Status";
import { projectPath } from "./object";

interface Holder {
  id: string;
  kind: "user" | "service-account";
  name: string;
  email?: string;
  role: string;
  relation: string;
}
interface Entry {
  id: string;
  path: string;
  subject: { type: "user" | "service"; id: string; name: string };
  role: string;
  propagate: boolean;
  relation: string;
  /** "server", or "project <name>". */
  on: string;
}
interface Access {
  cluster: string;
  platform?: Holder[];
  tenants: Array<{ tenant: { id: string; slug: string; name: string }; project: string; status: string; members: Holder[] }>;
  /** Explicit permission entries that reach here (older servers send none). */
  entries?: Entry[];
}

const holders = (list: Holder[], on: string, linkUsers: boolean) => (
  <MainTable
    emptyStateMsg="Nobody."
    headers={[{ content: "Who" }, { content: "Kind" }, { content: "IncusCloud role" }, { content: "In Incus" }]}
    rows={list.map((h) => ({
      key: `${h.kind}:${h.id}`,
      columns: [
        { content: h.kind === "user" && linkUsers ? <Link to={`/users/${h.id}`} title={h.email}>{h.name}</Link> : <span title={h.email}>{h.name}</span> },
        { content: h.kind === "user" ? "User" : "Service account" },
        { content: h.role },
        { content: h.relation ? `${h.relation} on ${on}` : "nothing" },
      ],
    }))}
  />
);

/**
 * Who has access to a cluster (or one of its projects), from IncusCloud's
 * roles: what each gives in Incus, as the reconciler grants it. Grants
 * IncusCloud does not own are on the Incus pages beside this one.
 */
const AccessPage: FC<{ cluster: string; project?: string }> = ({ cluster, project }) => {
  // Users' pages are the platform's.
  const { data: me } = useMe();
  const linkUsers = can(me, "viewer");
  const access = useQuery({
    queryKey: ["access", cluster, project ?? ""],
    queryFn: () => request<Access>("GET", `/api/v1/access?cluster=${encodeURIComponent(cluster)}${project ? `&project=${encodeURIComponent(project)}` : ""}`),
  });
  return (
    <PageLayout title="Who has access">
      <p className="u-text--muted">
        IncusCloud's roles, and what each gives in Incus. IncusCloud keeps them in {cluster}'s authorization store as its own <code>incuscloud-*</code> groups: platform roles on the server, tenant roles on the tenant's project (owners, admins
        and members operate it, viewers view it). Other grants are on the Incus pages beside this one.
      </p>
      <Loaded query={access}>
        {(a) => (
          <>
            {a.platform ? (
              <Section title="Platform roles" id="access-platform">
                {holders(a.platform, "the server", linkUsers)}
              </Section>
            ) : null}
            {a.entries?.length ? (
              <Section title="Permission entries" id="access-entries">
                <MainTable
                  headers={[{ content: "Who" }, { content: "On" }, { content: "Role" }, { content: "In Incus" }]}
                  rows={a.entries.map((e) => ({
                    key: e.id,
                    columns: [
                      { content: e.subject.name },
                      { content: <code className="ic-nowrap">{e.path}</code> },
                      { content: e.role },
                      { content: e.relation ? `${e.relation} on ${e.on === "server" ? "the server" : e.on}` : "nothing" },
                    ],
                  }))}
                />
                {canAtRoot(me, "acl.view") ? (
                  <p className="p-text--small">
                    Entries are managed on <Link to="/permissions">Permissions</Link>. An entry on a tenant or project that gives less than one above it there takes the server grant away, leaving grants on the other projects.
                  </p>
                ) : null}
              </Section>
            ) : null}
            {a.tenants.length === 0 ? <p>No tenant {project ? `has project ${project}` : "is placed"} on {cluster}.</p> : null}
            {a.tenants.map((t) => (
              <Section key={t.tenant.id} title={t.tenant.name} id={`access-tenant-${t.tenant.slug}`}>
                <p>
                  Tenant <Link to={`/tenants/${t.tenant.id}`}>{t.tenant.slug}</Link>, project <Link to={projectPath(`${t.project}@${cluster}`, "instances")}>{t.project}</Link>
                  {t.status !== "ready" ? ` (${t.status})` : ""}.
                </p>
                {holders(t.members, `project ${t.project}`, linkUsers)}
              </Section>
            ))}
          </>
        )}
      </Loaded>
    </PageLayout>
  );
};

export default AccessPage;
