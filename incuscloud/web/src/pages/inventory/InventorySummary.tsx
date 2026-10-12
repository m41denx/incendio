import type { FC, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCurrentProject } from "@incendio/ui/context/useCurrentProject";
import { useInstances } from "@incendio/ui/context/useInstances";
import { useClusterMembers } from "@incendio/ui/context/useClusterMembers";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { ClusterMember, FleetSummary } from "../../api/types";
import Meter from "../../components/Meter";
import { UNKNOWN, cores } from "../../lib/format";
import { clusterOf, inScope, nameOf, selectionOf } from "./tree";

const Stat: FC<{ label: string; children: ReactNode; wide?: boolean }> = ({ label, children, wide }) => (
  <div className={wide ? "ic-stat ic-stat--wide" : "ic-stat"}>
    <div className="ic-stat__label">{label}</div>
    <div className="ic-stat__value">{children}</div>
  </div>
);

const uptime = (s: number | null | undefined) => {
  if (s == null) return UNKNOWN;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
};

/**
 * What the tree has selected, summed up above the instance list: every
 * cluster, one cluster, or one node. Capacity (the fleet inventory) is
 * for platform viewers; everyone sees their instances' counts.
 */
const InventorySummary: FC = () => {
  const [params] = useSearchParams();
  const s = selectionOf(params);
  const { data: me } = useMe();
  const viewer = can(me, "viewer");
  const { project, isAllProjects } = useCurrentProject();
  const { data: instances = [] } = useInstances(isAllProjects ? null : (project?.name ?? null));
  const { data: members = [] } = useClusterMembers();
  const fleet = useQuery({ queryKey: ["fleet", "summary"], queryFn: () => request<FleetSummary>("GET", "/api/v1/fleet/summary"), enabled: viewer });
  const clusters = (fleet.data?.clusters ?? []).filter((c) => !s.cluster || c.name === s.cluster);
  const cluster = s.cluster ? clusters[0] : undefined;
  const inventory = useQuery({
    queryKey: ["clusters", cluster?.id, "inventory"],
    queryFn: () => request<{ members: ClusterMember[] }>("GET", `/api/v1/clusters/${cluster!.id}/inventory`),
    enabled: viewer && !!s.node && !!cluster,
  });

  const mine = instances.filter(inScope(s));
  const running = mine.filter((i) => i.status === "Running").length;
  const nodes = members.filter((m) => !s.cluster || clusterOf(m.server_name) === s.cluster);
  const online = nodes.filter((m) => m.status === "Online").length;
  const sum = (k: "memoryUsed" | "memoryTotal" | "storageUsed" | "storageTotal" | "cpuThreads") => clusters.reduce((n, c) => n + c[k], 0);

  if (s.node) {
    const label = nameOf(s.node);
    const list = inventory.data?.members ?? [];
    // A standalone server's member is named after the server, its node after the cluster.
    const m = list.find((x) => x.name === label) ?? (list.length === 1 ? list[0] : undefined);
    const member = members.find((x) => x.server_name === s.node);
    return (
      <section className="ic-stats" aria-label={`Node ${label}`}>
        <Stat label="Node">
          <Link to={`/ui/cluster/member/${encodeURIComponent(s.node)}`}>{label}</Link>
        </Stat>
        <Stat label="Status">{member?.status ?? m?.status ?? UNKNOWN}</Stat>
        <Stat label="Instances">
          {running} / {mine.length} running
        </Stat>
        {viewer ? (
          <>
            <Stat label="CPU threads">{m?.cpuThreads ?? UNKNOWN}</Stat>
            <Stat label="Load">{cores(m?.load1)}</Stat>
            <Stat label="Uptime">{uptime(m?.uptimeS)}</Stat>
            <Stat label="Memory" wide>
              <Meter used={m?.memoryUsed} total={m?.memoryTotal} label={`${label} memory`} />
            </Stat>
          </>
        ) : (
          <Stat label="Architecture">{member?.architecture || UNKNOWN}</Stat>
        )}
      </section>
    );
  }

  return (
    <section className="ic-stats" aria-label={s.cluster ? `Cluster ${s.cluster}` : "All clusters"}>
      {s.cluster ? (
        <Stat label="Cluster">{cluster ? <Link to={`/clusters/${cluster.id}`}>{s.cluster}</Link> : s.cluster}</Stat>
      ) : (
        <Stat label="Clusters">{new Set(members.map((m) => clusterOf(m.server_name))).size}</Stat>
      )}
      <Stat label="Nodes">
        {online} / {nodes.length} online
      </Stat>
      <Stat label="Instances">
        {running} / {mine.length} running
      </Stat>
      {viewer ? (
        <>
          <Stat label="CPU threads">{clusters.length ? sum("cpuThreads") : UNKNOWN}</Stat>
          <Stat label="Memory" wide>
            <Meter used={clusters.length ? sum("memoryUsed") : null} total={sum("memoryTotal")} label="Memory" />
          </Stat>
          <Stat label="Storage" wide>
            <Meter used={clusters.length ? sum("storageUsed") : null} total={sum("storageTotal")} label="Storage" />
          </Stat>
        </>
      ) : null}
    </section>
  );
};

export default InventorySummary;
