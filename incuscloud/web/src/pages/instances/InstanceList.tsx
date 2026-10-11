import { type FC } from "react";
import { Link } from "react-router-dom";
import { Button, Col, Input, MainTable, Row, Select } from "@canonical/react-components";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { request, withQuery } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { Instance, InstanceList, Tenant } from "../../api/types";
import { bytes, cores, UNKNOWN } from "../../lib/format";
import { useClusters } from "../clusters/ClusterList";
import { useUrlParam } from "../logs/TenantScope";

const LIMIT = 100;

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "Running", label: "Running" },
  { value: "Stopped", label: "Stopped" },
  { value: "Frozen", label: "Frozen" },
  { value: "Error", label: "Error" },
];
const TYPE_OPTIONS = [
  { value: "", label: "All" },
  { value: "container", label: "Container" },
  { value: "virtual-machine", label: "Virtual machine" },
];
const APPEARANCE: Record<string, string> = { Running: "positive", Error: "negative", Frozen: "caution" };

const statusClass = (status: string) => (APPEARANCE[status] ? `p-status-label--${APPEARANCE[status]}` : "p-status-label");
const typeLabel = (type: string) => (type === "virtual-machine" ? "VM" : type === "container" ? "Container" : type);

/** The first IPv4 address, if the instance has one. */
const ipv4 = (addresses: string[]) => addresses.find((a) => !a.includes(":")) ?? UNKNOWN;

/** The cluster filter, in its own component so only platform viewers fetch the clusters. */
const ClusterFilter: FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const clusters = useClusters();
  const options = [{ value: "", label: "All clusters" }, ...(clusters.data ?? []).map((c) => ({ value: c.id, label: c.name }))];
  return <Select id="instances-cluster" label="Cluster" options={options} value={value} onChange={(e) => onChange(e.target.value)} />;
};

/** Every instance the caller can see, filtered by the URL parameters, a page at a time. */
const InstancesPage: FC = () => {
  const { data: me } = useMe();
  const platform = can(me, "viewer");
  const q = useUrlParam("q", 300);
  const cluster = useUrlParam("cluster");
  const tenant = useUrlParam("tenant");
  const status = useUrlParam("status");
  const type = useUrlParam("type");

  const allTenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"), enabled: platform });
  const tenants: Array<{ id: string; name: string }> = platform ? (allTenants.data ?? []) : (me?.tenants ?? []);
  const tenantOptions = [{ value: "", label: "All tenants" }, ...tenants.map((t) => ({ value: t.id, label: t.name }))];

  // The cluster filter exists only for platform viewers, so a stale ?cluster= is not sent to anyone else.
  const filters = { q: q.value, cluster: platform ? cluster.value : "", tenant: tenant.value, status: status.value, type: type.value };
  const filtered = Object.values(filters).some(Boolean);

  const instances = useInfiniteQuery({
    queryKey: ["instances", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => request<InstanceList>("GET", withQuery("/api/v1/instances", { ...filters, limit: LIMIT, offset: pageParam })),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });
  const rows = instances.data?.pages.flatMap((p) => p.items) ?? [];
  const total = instances.data?.pages[0]?.total ?? 0;

  return (
    <PageLayout title="Instances">
      <Row>
        <Col size={4}>
          <Input id="instances-q" type="search" label="Search" placeholder="Name, address, project…" value={q.draft} onChange={(e) => q.set(e.target.value)} />
        </Col>
        {platform ? (
          <Col size={2}>
            <ClusterFilter value={cluster.value} onChange={cluster.set} />
          </Col>
        ) : null}
        {tenants.length >= 2 ? (
          <Col size={2}>
            <Select id="instances-tenant" label="Tenant" options={tenantOptions} value={tenant.value} onChange={(e) => tenant.set(e.target.value)} />
          </Col>
        ) : null}
        <Col size={2}>
          <Select id="instances-status" label="Status" options={STATUS_OPTIONS} value={status.value} onChange={(e) => status.set(e.target.value)} />
        </Col>
        <Col size={2}>
          <Select id="instances-type" label="Type" options={TYPE_OPTIONS} value={type.value} onChange={(e) => type.set(e.target.value)} />
        </Col>
      </Row>
      {instances.error ? (
        <ErrorMessage error={instances.error} />
      ) : instances.isPending ? (
        <Loading />
      ) : (
        <>
          <p className="ic-muted">{`Showing ${rows.length} of ${total} instances`}</p>
          <MainTable
            emptyStateMsg={filtered ? "No instances match." : "No instances yet. They appear here once a cluster's inventory has been read."}
            headers={[{ content: "Name" }, { content: "Cluster" }, { content: "Project" }, { content: "Status" }, { content: "Type" }, { content: "Location" }, { content: "IPv4" }, { content: "CPU" }, { content: "Memory" }]}
            rows={rows.map((i: Instance) => ({
              key: i.id,
              columns: [
                { content: <Link to={`/instances/${i.id}`}>{i.name}</Link> },
                { content: i.clusterName },
                {
                  content: (
                    <>
                      {i.project}
                      {/* Tenant projects are named after the tenant; say so only when they differ. */}
                      {i.tenantSlug && i.tenantSlug !== i.project ? <span className="ic-muted">{` · tenant ${i.tenantSlug}`}</span> : null}
                    </>
                  ),
                },
                { content: <span className={statusClass(i.status)}>{i.status}</span> },
                { content: typeLabel(i.type) },
                { content: i.location || UNKNOWN },
                { content: ipv4(i.addresses) },
                { content: cores(i.cpuCores) },
                { content: `${bytes(i.memoryUsed)}${i.memoryTotal ? ` / ${bytes(i.memoryTotal)}` : ""}` },
              ],
            }))}
          />
          {instances.hasNextPage ? (
            <Button onClick={() => instances.fetchNextPage()} disabled={instances.isFetchingNextPage}>
              Load more
            </Button>
          ) : null}
        </>
      )}
    </PageLayout>
  );
};

export default InstancesPage;
