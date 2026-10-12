import type { FC, ReactNode } from "react";
import { Link, Navigate, Route, useParams } from "react-router-dom";
import { Button, MainTable, Notification } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";
import { can, useMe } from "../api/hooks";
import type { Cluster, FleetSummary } from "../api/types";
import PageLayout from "../components/PageLayout";
import Meter from "../components/Meter";
import { Loading } from "../components/Status";
import { UNKNOWN } from "../lib/format";
import ClusterDetail from "../pages/clusters/ClusterDetail";
import { projectPath } from "./object";
import { IncendioAt, RenderAt } from "./RenderAt";
import { useInventory } from "./useInventory";

const enc = encodeURIComponent;
const useCluster = () => useParams<{ cluster: string }>().cluster ?? "";

const Stat: FC<{ label: string; children: ReactNode; wide?: boolean }> = ({ label, children, wide }) => (
  <div className={wide ? "ic-stat ic-stat--wide" : "ic-stat"}>
    <div className="ic-stat__label">{label}</div>
    <div className="ic-stat__value">{children}</div>
  </div>
);

/** A cluster's Summary: its nodes, instances and (for platform viewers) capacity. */
export const ClusterSummary: FC = () => {
  const cluster = useCluster();
  const { data: me } = useMe();
  const viewer = can(me, "viewer");
  const { root, isLoading } = useInventory("instances");
  const fleet = useQuery({ queryKey: ["fleet", "summary"], queryFn: () => request<FleetSummary>("GET", "/api/v1/fleet/summary"), enabled: viewer });
  const item = root.children?.find((c) => c.label === cluster);
  const cap = fleet.data?.clusters?.find((c) => c.name === cluster);
  const nodes = item?.children ?? [];
  const online = nodes.filter((n) => n.status === "Online").length;
  return (
    <PageLayout
      title="Summary"
      controls={
        <Button element={Link} to={projectPath(`default@${cluster}`, "instances/create")} appearance="positive" hasIcon>
          <span>Create instance</span>
        </Button>
      }
    >
      {isLoading && !item ? (
        <Loading />
      ) : !item ? (
        <Notification severity="caution" title="Not found">
          No cluster named {cluster} is available to you.
        </Notification>
      ) : (
        <>
          {item.status && item.status !== "ready" ? (
            <Notification severity="negative" title="Cluster status">
              {cluster} is {item.status}.
            </Notification>
          ) : null}
          <section className="ic-stats" aria-label={`Cluster ${cluster}`}>
            <Stat label="Members">
              {online} / {nodes.length} online
            </Stat>
            <Stat label="Instances">{item.count?.replace("/", " / ")} running</Stat>
            {viewer ? (
              <>
                <Stat label="CPU threads">{cap?.cpuThreads ?? UNKNOWN}</Stat>
                <Stat label="Memory" wide>
                  <Meter used={cap?.memoryUsed ?? null} total={cap?.memoryTotal ?? 0} label="Memory" />
                </Stat>
                <Stat label="Storage" wide>
                  <Meter used={cap?.storageUsed ?? null} total={cap?.storageTotal ?? 0} label="Storage" />
                </Stat>
              </>
            ) : null}
          </section>
          <h2 className="p-heading--5">Members</h2>
          <MainTable
            headers={[{ content: "Member" }, { content: "Status" }, { content: "Instances", className: "u-align--right" }]}
            rows={nodes.map((n) => ({
              columns: [
                { content: <Link to={n.to}>{n.label}</Link> },
                { content: n.status ?? UNKNOWN },
                { content: n.count ?? "0", className: "u-align--right" },
              ],
            }))}
          />
        </>
      )}
    </PageLayout>
  );
};

/** A cluster's projects: each one a project of its own (no shared name means anything). */
export const ClusterProjects: FC = () => {
  const cluster = useCluster();
  const { root, isLoading } = useInventory("projects");
  const item = root.children?.find((c) => c.label === cluster);
  return (
    <PageLayout title="Projects">
      {isLoading && !item ? (
        <Loading />
      ) : (
        <MainTable
          emptyStateMsg="No projects on this cluster are available to you."
          headers={[{ content: "Project" }, { content: "Instances", className: "u-align--right" }]}
          rows={(item?.children ?? []).map((p) => ({
            columns: [{ content: <Link to={p.to}>{p.label}</Link> }, { content: p.count ?? "0", className: "u-align--right" }],
          }))}
        />
      )}
    </PageLayout>
  );
};

/** IncusCloud's own settings of a cluster: its detail page, found by name. */
const ClusterSettings: FC<{ cluster: string }> = ({ cluster }) => {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters") });
  const id = clusters.data?.find((c) => c.name === cluster)?.id;
  if (!id) return clusters.isPending ? <Loading /> : <p className="u-text--muted">No cluster named {cluster}.</p>;
  return (
    <RenderAt path={`/clusters/${id}`}>
      <Route path="/clusters/:id" element={<ClusterDetail />} />
    </RenderAt>
  );
};

interface ConfigureItem {
  sub: string;
  label: string;
  operator?: boolean;
  page: (cluster: string) => ReactNode;
}
const CONFIGURE: ConfigureItem[] = [
  { sub: "incuscloud", label: "IncusCloud", operator: true, page: (c) => <ClusterSettings cluster={c} /> },
  { sub: "settings", label: "Server settings", page: () => <IncendioAt path="/ui/cluster/settings" /> },
  { sub: "groups", label: "Cluster groups", page: () => <IncendioAt path="/ui/cluster/groups" /> },
  { sub: "links", label: "Cluster links", page: () => <IncendioAt path="/ui/cluster/links" /> },
  { sub: "warnings", label: "Warnings", page: () => <IncendioAt path="/ui/warnings" /> },
];

/** A cluster's Configure tab: a side menu of its settings pages, the chosen one beside it. */
export const ClusterConfigure: FC = () => {
  const cluster = useCluster();
  const { sub } = useParams<{ sub: string }>();
  const { data: me } = useMe();
  const items = CONFIGURE.filter((i) => !i.operator || can(me, "operator"));
  const current = items.find((i) => i.sub === sub);
  if (!current) return <Navigate to={`/inventory/${enc(cluster)}/configure/${items[0]!.sub}`} replace />;
  return (
    <div className="ic-configure">
      <nav className="ic-configure__menu" aria-label="Configure">
        <ul className="p-list u-no-margin--bottom">
          {items.map((i) => (
            <li key={i.sub} className="p-list__item">
              <Link to={`/inventory/${enc(cluster)}/configure/${i.sub}`} className="ic-configure__link" aria-current={i === current ? "page" : undefined}>
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ic-configure__body">{current.page(cluster)}</div>
    </div>
  );
};

/** Incendio's page for this cluster, at its own path, inside the cluster's tab. */
export const ClusterIncendio: FC<{ path: (cluster: string) => string }> = ({ path }) => <IncendioAt path={path(useCluster())} />;

/** Old cluster links (`/clusters/<id>`): that cluster's IncusCloud settings. */
export const ClusterRedirect: FC = () => {
  const { id } = useParams<{ id: string }>();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters") });
  const name = clusters.data?.find((c) => c.id === id)?.name;
  if (clusters.isPending) return <Loading />;
  return <Navigate to={name ? `/inventory/${enc(name)}/configure/incuscloud` : "/all/clusters"} replace />;
};

/** A cluster tab's old name: the same tab under its new one. */
export const ClusterRename: FC<{ to: string }> = ({ to }) => <Navigate to={`/inventory/${enc(useCluster())}/${to}`} replace />;
