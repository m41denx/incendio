import type { FC } from "react";
import { Link } from "react-router-dom";
import { MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../api/client";
import type { ResourceUsage, TenantUsage as Usage } from "../../api/types";
import KeyValues from "../../components/KeyValues";
import Meter from "../../components/Meter";
import { Loaded } from "../../components/Status";
import { UNKNOWN, bytes } from "../../lib/format";

type Resource = keyof ResourceUsage;

/** Quota is set in GiB for memory and disk; usage and limits are always in Incus units (counts, CPUs, bytes). */
const RESOURCES: Array<{ key: Resource; label: string; format: (n: number) => string; quotaScale: number }> = [
  { key: "instances", label: "Instances", format: (n) => String(n), quotaScale: 1 },
  { key: "cpu", label: "CPUs", format: (n) => String(n), quotaScale: 1 },
  { key: "memory", label: "Memory", format: bytes, quotaScale: 1024 ** 3 },
  { key: "disk", label: "Disk", format: bytes, quotaScale: 1024 ** 3 },
];

const Summary: FC<{ usage: Usage }> = ({ usage }) => (
  <KeyValues
    items={RESOURCES.map((r) => {
      const used = usage.used[r.key];
      const quota = usage.quota[r.key];
      if (quota === undefined) return [r.label, `${r.format(used)} used, no limit`];
      // A meter of nothing would show nothing: say what is used of it.
      if (quota === 0) return [r.label, `${r.format(used)} used of 0`];
      const total = quota * r.quotaScale;
      return [r.label, <Meter key={r.key} used={used} total={total} label={`${r.label} used`} format={r.format} />];
    })}
  />
);

const cellText = (r: (typeof RESOURCES)[number], c: Usage["clusters"][number]) => {
  if (c.usage == null) return UNKNOWN;
  const limit = c.limits?.[r.key];
  return limit == null ? r.format(c.usage[r.key]) : `${r.format(c.usage[r.key])} of ${r.format(limit)}`;
};

const TenantUsage: FC<{ tenantId: string }> = ({ tenantId }) => {
  const query = useQuery({
    queryKey: ["tenants", tenantId, "usage"],
    queryFn: () => request<Usage>("GET", `/api/v1/tenants/${tenantId}/usage`),
  });
  return (
    <Loaded query={query}>
      {(usage) => (
        <>
          <Summary usage={usage} />
          <MainTable
            headers={[{ content: "Cluster" }, { content: "Project" }, ...RESOURCES.map((r) => ({ content: r.label }))]}
            rows={usage.clusters.map((c) => ({
              key: c.clusterId,
              columns: [
                { content: <Link to={`/clusters/${c.clusterId}`}>{c.clusterName}</Link> },
                { content: <span className="mono-font">{c.project}</span> },
                ...RESOURCES.map((r) => ({ content: cellText(r, c) })),
              ],
            }))}
            emptyStateMsg="Not placed on any cluster yet."
          />
          <p className="u-text--muted">Each cluster may use what it already has plus whatever the tenant has left, so the total never exceeds the quota.</p>
        </>
      )}
    </Loaded>
  );
};

export default TenantUsage;
