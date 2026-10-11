import { type FC, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionButton, CheckboxInput, MainTable, Notification } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import ConfirmAction from "../../components/ConfirmAction";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { Job, Me, ReplicationPolicy } from "../../api/types";
import { useClusters } from "../clusters/ClusterList";

const POLICIES = "/api/v1/replication-policies";

/** "15 min", "1 h", "1 day": the interval in its largest whole unit. */
const every = (seconds: number) => {
  if (seconds % 86400 === 0) return seconds === 86400 ? "1 day" : `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
};

/** Platform operators, and owners and admins of the policy's tenant, manage it; others read it. */
const manages = (me: Me | undefined, p: ReplicationPolicy) => can(me, "operator") || ["owner", "admin"].includes(tenantRole(me, p.tenantId ?? "") ?? "");

/** Fail over: starts the replica and ends the policy; the source may be stopped first. */
const FailOver: FC<{ policy: ReplicationPolicy; onError: (e: unknown) => void }> = ({ policy, onError }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [stopSource, setStopSource] = useState(true);
  return (
    <ConfirmAction
      label="Fail over…"
      title="Fail over to the replica?"
      className="is-small u-no-margin--bottom"
      appearance="base"
      onError={onError}
      onConfirm={async () => {
        const job = await request<Job>("POST", `${POLICIES}/${policy.id}/failover`, { stopSource });
        await qc.invalidateQueries({ queryKey: ["replication-policies"] });
        navigate(`/jobs/${job.id}`);
      }}
    >
      <p>
        The replica <code>{`${policy.targetProject}/${policy.targetName}`}</code> is started and replication stops; the policy ends.
      </p>
      <CheckboxInput id={`stop-source-${policy.id}`} label="Stop the source instance first" checked={stopSource} onChange={() => setStopSource((on) => !on)} />
    </ConfirmAction>
  );
};

/** Every replication policy the caller can see, with its schedule, last copy and the actions it allows. */
const PolicyList: FC = () => {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const clusters = useClusters();
  const policies = useQuery({ queryKey: ["replication-policies"], queryFn: () => request<ReplicationPolicy[]>("GET", POLICIES) });
  const [error, setError] = useState<unknown>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const clusterName = (id: string) => clusters.data?.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  const refresh = () => qc.invalidateQueries({ queryKey: ["replication-policies"] });
  const run = async (p: ReplicationPolicy) => {
    const job = await request<Job>("POST", `${POLICIES}/${p.id}/run`);
    setStarted(job.id);
  };
  const pause = (p: ReplicationPolicy) => request("PATCH", `${POLICIES}/${p.id}`, { enabled: !p.enabled });
  const remove = (p: ReplicationPolicy) => request("DELETE", `${POLICIES}/${p.id}`);

  /** Runs one action for a policy, showing its failure. */
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setStarted(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <PageLayout title="Replication">
      <p className="ic-muted">Each policy keeps a stopped copy of an instance on another cluster, refreshed on its schedule. Failing over starts the copy.</p>
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      {started ? (
        <Notification severity="positive" title="Copy started">
          <Link to={`/jobs/${started}`}>View job</Link>
        </Notification>
      ) : null}
      <Loaded query={policies}>
        {(list) => {
          const showActions = list.some((p) => manages(me, p));
          return (
            <MainTable
              emptyStateMsg="No replication policies yet. Create one from an instance's page."
              headers={[
                { content: "Instance" },
                { content: "Replica" },
                { content: "Every" },
                { content: "Last copy" },
                { content: "State" },
                ...(showActions ? [{ content: "", className: "u-align--right ic-col-actions" }] : []),
              ]}
              rows={list.map((p) => {
                const failedOver = p.state === "failed-over";
                const canManage = manages(me, p);
                const state = failedOver ? "Failed over" : p.enabled ? "Active" : "Paused";
                const stateClass = failedOver ? "p-status-label--caution" : p.enabled ? "p-status-label--positive" : "p-status-label";
                return {
                  key: p.id,
                  columns: [
                    {
                      content: (
                        <>
                          <span className="ic-mono">{`${p.sourceProject}/${p.instanceName}`}</span>
                          <br />
                          <span className="ic-muted">{clusterName(p.sourceClusterId)}</span>
                        </>
                      ),
                    },
                    {
                      content: (
                        <>
                          <span className="ic-mono">{`${p.targetProject}/${p.targetName}`}</span>
                          <br />
                          <span className="ic-muted">{clusterName(p.targetClusterId)}</span>
                        </>
                      ),
                    },
                    { content: every(p.intervalS) },
                    {
                      content: (
                        <>
                          <span>{ago(p.lastSuccessAt)}</span>
                          {p.lastError ? (
                            <>
                              {" "}
                              <span className="ic-negative" title={p.lastError}>
                                Failed
                              </span>
                            </>
                          ) : null}
                        </>
                      ),
                    },
                    { content: <span className={stateClass}>{state}</span> },
                    ...(showActions
                      ? [
                          {
                            className: "u-align--right",
                            content: canManage ? (
                              <div className="ic-page-controls" style={{ justifyContent: "flex-end" }}>
                                {failedOver ? null : (
                                  <>
                                    <ActionButton
                                      className="is-small u-no-margin--bottom"
                                      loading={busy === `run:${p.id}`}
                                      disabled={!!busy}
                                      onClick={() => act(`run:${p.id}`, () => run(p))}
                                    >
                                      Run now
                                    </ActionButton>
                                    <ActionButton
                                      className="is-small u-no-margin--bottom"
                                      loading={busy === `pause:${p.id}`}
                                      disabled={!!busy}
                                      onClick={() => act(`pause:${p.id}`, () => pause(p))}
                                    >
                                      {p.enabled ? "Pause" : "Resume"}
                                    </ActionButton>
                                    <FailOver policy={p} onError={setError} />
                                  </>
                                )}
                                <ConfirmAction
                                  label="Delete"
                                  title={`Delete the replication of ${p.instanceName}?`}
                                  className="is-small u-no-margin--bottom"
                                  onConfirm={() => act("delete", () => remove(p))}
                                >
                                  <p>The replica instance is kept on its cluster. Only the policy is removed, so replication stops.</p>
                                </ConfirmAction>
                              </div>
                            ) : null,
                          },
                        ]
                      : []),
                  ],
                };
              })}
            />
          );
        }}
      </Loaded>
    </PageLayout>
  );
};

export default PolicyList;
