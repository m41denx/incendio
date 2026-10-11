import type { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Col, Row } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../components/PageLayout";
import { Loaded, ago } from "../components/Status";
import { request } from "../api/client";
import { can, useMe } from "../api/hooks";
import type { Cluster, Tenant, User } from "../api/types";
import ClusterStatus from "./clusters/ClusterStatus";

/** Known statuses in the order they are reported, then anything else. */
const STATUS_ORDER = ["ready", "degraded", "error", "pending", "disabled"];

const statusRank = (s: string) => (s === "error" ? 0 : s === "degraded" ? 1 : 2);


/** "3 ready · 1 degraded". */
const breakdown = (clusters: Cluster[]) => {
  const counts = new Map<string, number>();
  for (const c of clusters) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  const others = [...counts.keys()].filter((s) => !STATUS_ORDER.includes(s)).sort();
  return [...STATUS_ORDER, ...others].filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`).join(" · ");
};

const StatCard: FC<{ id: string; title: string; to: string; children: ReactNode }> = ({ id, title, to, children }) => (
  <section className="p-card" aria-labelledby={id}>
    <h2 id={id} className="p-heading--5">
      <Link to={to}>{title}</Link>
    </h2>
    {children}
  </section>
);

const Dashboard: FC = () => {
  const { data: me } = useMe();
  const platformViewer = can(me, "viewer");
  const admin = can(me, "admin");
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters") });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants") });
  const users = useQuery({ queryKey: ["users"], queryFn: () => request<User[]>("GET", "/api/v1/users"), enabled: platformViewer });
  const width = platformViewer ? 4 : 6;
  const attention = (clusters.data ?? []).filter((c) => c.status !== "ready" && c.status !== "disabled").sort((a, b) => statusRank(a.status) - statusRank(b.status));

  return (
    <PageLayout title="Dashboard">
      <Row>
        <Col size={width}>
          <StatCard id="dash-clusters" title="Clusters" to="/clusters">
            <Loaded query={clusters}>
              {(list) => (
                <>
                  <p className="p-heading--2">{list.length}</p>
                  {list.length ? <p className="ic-muted">{breakdown(list)}</p> : null}
                </>
              )}
            </Loaded>
          </StatCard>
        </Col>
        <Col size={width}>
          <StatCard id="dash-tenants" title="Tenants" to="/tenants">
            <Loaded query={tenants}>{(list) => <p className="p-heading--2">{list.length}</p>}</Loaded>
          </StatCard>
        </Col>
        {platformViewer ? (
          <Col size={width}>
            <StatCard id="dash-users" title="Users" to="/users">
              <Loaded query={users}>{(list) => <p className="p-heading--2">{list.length}</p>}</Loaded>
            </StatCard>
          </Col>
        ) : null}
      </Row>

      <section aria-labelledby="dash-attention">
        <h2 id="dash-attention" className="p-heading--4">
          Needs attention
        </h2>
        <Loaded query={clusters}>
          {(list) => {
            if (!list.length) {
              return admin ? (
                <p>
                  No clusters yet. <Link to="/clusters">Enrol a cluster</Link>
                </p>
              ) : (
                <p className="ic-muted">No clusters are available to you yet.</p>
              );
            }
            if (!attention.length) return <p>All clusters are healthy.</p>;
            return (
              <ul className="p-list">
                {attention.map((c) => (
                  <li key={c.id} className="p-list__item">
                    <Link to={`/clusters/${c.id}`}>{c.name}</Link> <ClusterStatus status={c.status} />
                    {c.statusMessage ? <span> {c.statusMessage}</span> : null}
                    <span className="ic-muted"> · Last reconciled: {ago(c.reconciledAt)}</span>
                  </li>
                ))}
              </ul>
            );
          }}
        </Loaded>
      </section>

      {me?.tenants.length ? (
        <section aria-labelledby="dash-mine">
          <h2 id="dash-mine" className="p-heading--4">
            My tenants
          </h2>
          <ul className="p-list">
            {me.tenants.map((t) => (
              <li key={t.id} className="p-list__item">
                <Link to={`/tenants/${t.id}`}>{t.name}</Link> <span className="ic-muted">{t.role}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageLayout>
  );
};

export default Dashboard;
