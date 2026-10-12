import type { FC, ReactNode } from "react";
import { Link, Navigate, Route, useParams, useSearchParams } from "react-router-dom";
import { Button, MainTable, Notification, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";
import { can, useMe } from "../api/hooks";
import type { Cluster, FleetSummary } from "../api/types";
import PageLayout from "../components/PageLayout";
import Meter from "../components/Meter";
import { Loading } from "../components/Status";
import { UNKNOWN } from "../lib/format";
import { clusterOf, nameOf } from "../pages/inventory/tree";
import ClusterDetail from "../pages/clusters/ClusterDetail";
import { clusterSubs, projectPath } from "./object";
import { IncendioAt, RenderAt } from "./RenderAt";
import AccessPage from "./AccessPage";
import { useHome, useInventory } from "./useInventory";

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
  const home = useHome();
  const fleet = useQuery({ queryKey: ["fleet", "summary"], queryFn: () => request<FleetSummary>("GET", "/api/v1/fleet/summary"), enabled: viewer });
  const item = root.children?.find((c) => c.label === cluster);
  const cap = fleet.data?.clusters?.find((c) => c.name === cluster);
  const nodes = item?.children ?? [];
  const online = nodes.filter((n) => n.status === "Online").length;
  return (
    <PageLayout
      title="Summary"
      controls={
        <Button element={Link} to={projectPath(home(cluster), "instances/create")} appearance="positive" hasIcon>
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

/** A cluster's placement groups: Incendio's page for one of its projects, picked here. */
const PlacementGroups: FC<{ cluster: string }> = ({ cluster }) => {
  const { root } = useInventory("projects");
  const [params, setParams] = useSearchParams();
  const projects = (root.children?.find((c) => c.label === cluster)?.children ?? []).map((p) => p.label);
  const project = params.get("project") || "default";
  return (
    <div className="ic-picked">
      <div className="ic-picked__picker">
        <Select
          id="placement-project"
          label="Project"
          value={project}
          onChange={(e) => setParams({ project: e.target.value }, { replace: true })}
          options={(projects.length ? projects : [project]).map((p) => ({ label: p, value: p }))}
        />
      </div>
      <IncendioAt path={projectPath(`${project}@${cluster}`, "placement-groups")} />
    </div>
  );
};

/** IncusCloud's own pages in a cluster tab's side menu; the others are Incendio's. */
const OWN: Record<string, (cluster: string) => ReactNode> = {
  "configure/incuscloud": (c) => <ClusterSettings cluster={c} />,
  "groups/placement": (c) => <PlacementGroups cluster={c} />,
  "access/who": (c) => <AccessPage cluster={c} />,
};

/** A page of a cluster tab with a side menu (the frame draws the menu); its first page when none or an unknown one is named. */
export const ClusterSub: FC = () => {
  const cluster = useCluster();
  const { tab = "", sub } = useParams<{ tab: string; sub: string }>();
  const { data: me } = useMe();
  const home = useHome();
  const subs = clusterSubs(cluster, tab as never, { operator: can(me, "operator"), viewer: can(me, "viewer"), home });
  const current = subs.find((s) => s.sub === sub);
  if (!subs.length) return <Navigate to={`/inventory/${enc(cluster)}`} replace />;
  if (!current) return <Navigate to={`/inventory/${enc(cluster)}/${tab}/${subs[0]!.sub}`} replace />;
  const own = OWN[`${tab}/${current.sub}`];
  return own ? <>{own(cluster)}</> : <IncendioAt key={current.path} path={current.path} />;
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

/** A project's Access › Who has access: its tenant's members, from IncusCloud's roles. */
export const ProjectAccessPage: FC = () => {
  const { project = "" } = useParams<{ project: string }>();
  return <AccessPage key={project} cluster={clusterOf(project)} project={nameOf(project)} />;
};
