import { type FC, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ContextualMenu } from "@canonical/react-components";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import Sparkline, { type SparkPoint } from "../../components/Sparkline";
import { Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { Instance, MetricSample } from "../../api/types";
import { UNKNOWN, bytes, cores, rate } from "../../lib/format";
import MigrateInstance from "./MigrateInstance";
import CreatePolicy from "../replication/CreatePolicy";
import BackupNow from "../backups/BackupNow";
import BackupSchedule from "../backups/BackupSchedule";
import Section from "../../components/Section";

const HOURS = 24;
const REFRESH_MS = 60_000;

const limits = (i: Instance) => {
  const parts = [i.limitsCpu && `${i.limitsCpu} CPU${i.limitsCpu === "1" ? "" : "s"}`, i.limitsMemory].filter(Boolean);
  return parts.length ? parts.join(", ") : "No limits";
};
const series = (samples: MetricSample[], pick: (s: MetricSample) => number | null): SparkPoint[] => samples.map((s) => ({ at: s.at, value: pick(s) }));

/** One instance from the fleet inventory: facts, a console link and its recent CPU, memory and network use. */
const InstanceDetail: FC = () => {
  const { id = "" } = useParams();
  const instance = useQuery({ queryKey: ["instances", id], queryFn: () => request<Instance>("GET", `/api/v1/instances/${id}`), refetchInterval: REFRESH_MS });
  const metrics = useQuery({
    queryKey: ["instances", id, "metrics"],
    queryFn: () => request<{ samples: MetricSample[] }>("GET", `/api/v1/instances/${id}/metrics?hours=${HOURS}`),
    refetchInterval: REFRESH_MS,
  });
  const i = instance.data;
  const { data: me } = useMe();
  const [dialog, setDialog] = useState<"migrate" | "replicate" | "backup" | "schedule" | null>(null);
  const close = () => setDialog(null);
  // Platform operators, and the tenant's owners and admins, may move it (the API decides).
  const manages = !!i && (can(me, "operator") || ["owner", "admin"].includes((i.tenantId && tenantRole(me, i.tenantId)) || ""));

  return (
    <PageLayout
      title={
        <>
          <Link to="/instances">Instances</Link> / {i?.name ?? "…"}
        </>
      }
      controls={
        i ? (
          <>
            {manages ? (
              <ContextualMenu
                hasToggleIcon
                position="right"
                toggleLabel="Actions"
                links={[
                  { children: "Move or copy…", onClick: () => setDialog("migrate") },
                  { children: "Replicate…", onClick: () => setDialog("replicate") },
                  { children: "Back up now…", onClick: () => setDialog("backup") },
                  { children: "Backup schedule…", onClick: () => setDialog("schedule") },
                ]}
              />
            ) : null}
            {/* Served by the server (Incendio for that cluster), not this app. */}
            <a className="p-button" href={`/clusters/${encodeURIComponent(i.clusterName)}/ui/project/${encodeURIComponent(i.project)}/instance/${encodeURIComponent(i.name)}`}>
              Open in console
            </a>
          </>
        ) : null
      }
    >
      {i && dialog === "migrate" ? <MigrateInstance instance={i} onClose={close} /> : null}
      {i && dialog === "replicate" ? <CreatePolicy instance={i} onClose={close} /> : null}
      {i && dialog === "backup" ? <BackupNow instance={i} onClose={close} /> : null}
      {i && dialog === "schedule" ? <BackupSchedule instance={i} onClose={close} /> : null}
      <Loaded query={instance}>
        {(i) => (
          <>
            <Section title="General" id="instance-general">
            <KeyValues
              items={[
                ["Status", i.status],
                ["Cluster", <Link to={`/clusters/${i.clusterId}`}>{i.clusterName}</Link>],
                ["Project", i.project],
                ...(i.tenantId ? [["Tenant", <Link to={`/tenants/${i.tenantId}`}>{i.tenantSlug}</Link>] as [string, React.ReactNode]] : []),
                ...(i.owner !== undefined ? [["Owner", i.owner ? `${i.owner.name}${i.owner.type === "service" ? " (service account)" : ""}` : "Nobody"] as [string, React.ReactNode]] : []),
                ["Type", i.type === "virtual-machine" ? "Virtual machine" : "Container"],
                ["Location", i.location || UNKNOWN],
                ["Description", i.description || UNKNOWN],
                ["Image", [i.imageOs, i.imageRelease].filter(Boolean).join(" ") || UNKNOWN],
                ["Limits", limits(i)],
                ["Addresses", i.addresses.length ? <span className="mono-font">{i.addresses.join(", ")}</span> : UNKNOWN],
                ["Disk used", bytes(i.diskUsed)],
                ["Created", i.createdAt ? new Date(i.createdAt).toLocaleString() : UNKNOWN],
                ["Inventory read", ago(i.inventoryAt)],
              ]}
            />
            </Section>
            <Section title={`Last ${HOURS} hours`} id="instance-metrics">
            <Loaded query={metrics}>
              {({ samples }) => (
                <div className="ic-spark-grid">
                  <Sparkline label="CPU" points={series(samples, (s) => s.cpuCores)} format={(n) => `${cores(n)} cores`} />
                  <Sparkline label="Memory" points={series(samples, (s) => s.memoryUsed)} format={bytes} max={i.memoryTotal ?? undefined} />
                  <Sparkline label="Network in" points={series(samples, (s) => s.netRxBps)} format={rate} />
                  <Sparkline label="Network out" points={series(samples, (s) => s.netTxBps)} format={rate} />
                </div>
              )}
            </Loaded>
            </Section>
          </>
        )}
      </Loaded>
    </PageLayout>
  );
};

export default InstanceDetail;
