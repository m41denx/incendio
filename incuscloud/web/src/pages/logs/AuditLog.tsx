import { type FC, useState } from "react";
import { Button, Col, Input, MainTable, Notification, Row } from "@canonical/react-components";
import { useInfiniteQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { request, withQuery } from "../../api/client";
import { useMe } from "../../api/hooks";
import type { AuditEntry } from "../../api/types";
import { TenantScopeSelect, useTenantScope, useUrlParam } from "./TenantScope";
import Failed from "../../components/Failed";

const LIMIT = 100;
const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

const AuditLog: FC = () => {
  const { data: me } = useMe();
  const scope = useTenantScope(me);
  const actor = useUrlParam("actor", 300);
  const action = useUrlParam("action", 300);
  const [openId, setOpenId] = useState<number | null>(null);
  const enabled = !!me && (scope.platform || scope.value !== "");

  const audit = useInfiniteQuery({
    queryKey: ["audit", { tenant: scope.value, actor: actor.value, action: action.value }],
    enabled,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      request<AuditEntry[]>("GET", withQuery("/api/v1/audit", { tenant: scope.value, actor: actor.value, action: action.value, before: pageParam, limit: LIMIT })),
    getNextPageParam: (last) => (last.length < LIMIT ? undefined : last[last.length - 1]!.id),
  });
  const rows = audit.data?.pages.flat() ?? [];

  return (
    <PageLayout title="Audit log">
      <Row>
        <Col size={4}>
          <TenantScopeSelect scope={scope} />
        </Col>
        <Col size={4}>
          <Input id="audit-actor" type="text" label="Actor id" value={actor.draft} onChange={(e) => actor.set(e.target.value)} />
        </Col>
        <Col size={4}>
          <Input id="audit-action" type="text" label="Action" placeholder="e.g. tenant.create" value={action.draft} onChange={(e) => action.set(e.target.value)} />
        </Col>
      </Row>
      {!me ? (
        <Loading />
      ) : scope.none ? (
        <Notification severity="information" title="No tenant to show">
          You are not an owner or admin of any tenant, so there is no audit log to show.
        </Notification>
      ) : audit.error ? (
        <ErrorMessage error={audit.error} />
      ) : audit.isPending ? (
        <Loading />
      ) : (
        <>
          <MainTable
            expanding
            emptyStateMsg="No audit entries match these filters."
            headers={[{ content: "Time" }, { content: "Actor" }, { content: "Action" }, { content: "Target" }, { content: "Result" }, { content: "IP" }]}
            rows={rows.map((a) => ({
              key: a.id,
              expanded: openId === a.id,
              expandedContent: <pre>{JSON.stringify(a.detail, null, 2)}</pre>,
              onClick: () => setOpenId(openId === a.id ? null : a.id),
              columns: [
                { content: new Date(a.at).toLocaleString() },
                {
                  content: (
                    <>
                      {a.actorType} <span className="mono-font" title={a.actorId}>{shortId(a.actorId)}</span>
                    </>
                  ),
                },
                { content: a.action },
                {
                  content: (
                    <>
                      {a.targetType} <span className="mono-font" title={a.targetId}>{shortId(a.targetId)}</span>
                    </>
                  ),
                },
                { content: a.result === "success" ? a.result : <Failed>Failed</Failed> },
                { content: a.ip },
              ],
            }))}
          />
          {audit.hasNextPage ? (
            <Button onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
              Load older
            </Button>
          ) : null}
        </>
      )}
    </PageLayout>
  );
};

export default AuditLog;
