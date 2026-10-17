import type { FC } from "react";
import { Button, Col, Input, MainTable, Notification, Row, Select } from "@canonical/react-components";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { bytes } from "../../lib/format";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { request, withQuery } from "../../api/client";
import { useMe } from "../../api/hooks";
import type { Cluster, GatewayRequest } from "../../api/types";
import { TenantScopeSelect, useTenantScope, useUrlParam } from "./TenantScope";
import Failed from "../../components/Failed";

const LIMIT = 100;
const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);


const GatewayLog: FC = () => {
  const { data: me } = useMe();
  const scope = useTenantScope(me);
  const cluster = useUrlParam("cluster");
  const actor = useUrlParam("actor", 300);
  const enabled = !!me && (scope.platform || scope.value !== "");
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters") });
  const names = new Map((clusters.data ?? []).map((c) => [c.id, c.name]));

  const log = useInfiniteQuery({
    queryKey: ["gateway-requests", { tenant: scope.value, cluster: cluster.value, actor: actor.value }],
    enabled,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      request<GatewayRequest[]>("GET", withQuery("/api/v1/gateway-requests", { tenant: scope.value, cluster: cluster.value, actor: actor.value, before: pageParam, limit: LIMIT })),
    getNextPageParam: (last) => (last.length < LIMIT ? undefined : last[last.length - 1]!.id),
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <PageLayout title="Gateway log">
      <p className="u-text--muted">
        Changes, websockets and refusals are always logged. Reads are logged only as sampled by the server's IC_GATEWAY_SAMPLE_READS setting.
      </p>
      <Row>
        <Col size={4}>
          <TenantScopeSelect scope={scope} />
        </Col>
        <Col size={4}>
          <Select
            id="gateway-cluster"
            label="Cluster"
            value={cluster.value}
            onChange={(e) => cluster.set(e.target.value)}
            options={[{ value: "", label: "All clusters" }, ...(clusters.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Col>
        <Col size={4}>
          <Input id="gateway-actor" type="text" label="Actor id" value={actor.draft} onChange={(e) => actor.set(e.target.value)} />
        </Col>
      </Row>
      {!me ? (
        <Loading />
      ) : scope.none ? (
        <Notification severity="information" title="No tenant to show">
          You are not an owner or admin of any tenant, so there is no gateway log to show.
        </Notification>
      ) : log.error ? (
        <ErrorMessage error={log.error} />
      ) : log.isPending ? (
        <Loading />
      ) : (
        <>
          <MainTable
            emptyStateMsg="No gateway requests match these filters."
            headers={[
              { content: "Time" },
              { content: "Cluster" },
              { content: "Actor" },
              { content: "Method" },
              { content: "Path" },
              { content: "Status" },
              { content: "Bytes in" },
              { content: "Bytes out" },
              { content: "Duration (ms)" },
            ]}
            rows={rows.map((r) => ({
              key: r.id,
              columns: [
                { content: new Date(r.at).toLocaleString() },
                {
                  content: r.clusterId === null ? "—" : names.has(r.clusterId) ? names.get(r.clusterId) : <span className="mono-font" title={r.clusterId}>{shortId(r.clusterId)}</span>,
                },
                { content: <span className="mono-font" title={r.actorId}>{shortId(r.actorId)}</span> },
                { content: r.method },
                { content: <span className="mono-font ic-wrap">{r.path}</span> },
                { content: r.status >= 400 ? <Failed>{r.status}</Failed> : r.status },
                { content: bytes(r.bytesIn) },
                { content: bytes(r.bytesOut) },
                { content: r.durationMs },
              ],
            }))}
          />
          {log.hasNextPage ? (
            <Button onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
              Load older
            </Button>
          ) : null}
        </>
      )}
    </PageLayout>
  );
};

export default GatewayLog;
