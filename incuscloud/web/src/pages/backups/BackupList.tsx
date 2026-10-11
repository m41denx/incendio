import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, Button, MainTable, Notification } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import ConfirmAction from "../../components/ConfirmAction";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { request, withQuery } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { Backup, BackupPolicy, BackupTarget, Job, Me } from "../../api/types";
import { bytes, UNKNOWN } from "../../lib/format";
import { useUrlParam } from "../logs/TenantScope";
import RestoreBackup from "./RestoreBackup";

const BACKUPS = "/api/v1/backups";
const POLICIES = "/api/v1/backup-policies";
const TARGETS = "/api/v1/backup-targets";
/** A backup being made is polled this often until it is ready or failed. */
const POLL_MS = 3_000;

/** "1 h", "1 day", "1 week", otherwise hours, e.g. "1.5 h". */
const every = (seconds: number) => {
  if (seconds === 86400) return "1 day";
  if (seconds === 604800) return "1 week";
  return `${+(seconds / 3600).toFixed(2)} h`;
};

/** Platform operators, and owners and admins of the row's tenant, manage it; others only read it. */
const manages = (me: Me | undefined, tenantId: string | null) => can(me, "operator") || ["owner", "admin"].includes(tenantRole(me, tenantId ?? "") ?? "");

const shortId = (id: string) => id.slice(0, 8);

/** The state of a backup as a status label; a failed one says why in its title. */
const BackupStateLabel: FC<{ backup: Backup }> = ({ backup }) => {
  if (backup.state === "creating") return <span className="p-status-label--information">Creating</span>;
  if (backup.state === "failed") return <span className="p-status-label--negative" title={backup.error}>Failed</span>;
  return <span className="p-status-label--positive">Ready</span>;
};

/** Backups, and the schedules that make them, with the actions the caller may take on each. */
const BackupList: FC = () => {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const instance = useUrlParam("instance");
  const [error, setError] = useState<unknown>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [restoring, setRestoring] = useState<Backup | null>(null);

  const backups = useQuery({
    queryKey: ["backups", { instance: instance.value }],
    queryFn: () => request<Backup[]>("GET", withQuery(BACKUPS, { instance: instance.value })),
    refetchInterval: (q) => (q.state.data?.some((b) => b.state === "creating") ? POLL_MS : false),
  });
  const policies = useQuery({ queryKey: ["backup-policies"], queryFn: () => request<BackupPolicy[]>("GET", POLICIES) });
  const targets = useQuery({ queryKey: ["backup-targets"], queryFn: () => request<BackupTarget[]>("GET", TARGETS) });

  const targetName = (id: string) => targets.data?.find((t) => t.id === id)?.name ?? shortId(id);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["backups"] });
    await qc.invalidateQueries({ queryKey: ["backup-policies"] });
  };
  const removeBackup = (b: Backup) => request("DELETE", `${BACKUPS}/${b.id}`);
  const run = async (p: BackupPolicy) => {
    const job = await request<Job>("POST", `${POLICIES}/${p.id}/run`);
    setStarted(job.id);
  };
  const pause = (p: BackupPolicy) => request("PATCH", `${POLICIES}/${p.id}`, { enabled: !p.enabled });
  const removePolicy = (p: BackupPolicy) => request("DELETE", `${POLICIES}/${p.id}`);

  /** Runs one action, showing its failure. */
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
    <PageLayout title="Backups">
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      {started ? (
        <Notification severity="positive" title="Backup started">
          <Link to={`/jobs/${started}`}>View job</Link>
        </Notification>
      ) : null}

      <h2 className="p-heading--4">Backups</h2>
      {instance.value ? (
        <p className="ic-muted">
          Backups of one instance · <Link to="/backups">show all</Link>
        </p>
      ) : null}
      <Loaded query={backups}>
        {(list) => {
          const showActions = list.some((b) => manages(me, b.tenantId));
          return (
            <MainTable
              emptyStateMsg="No backups yet. Back an instance up from its page."
              headers={[
                { content: "Instance" },
                { content: "Made" },
                { content: "Size" },
                { content: "Target" },
                { content: "State" },
                ...(showActions ? [{ content: "", className: "u-align--right ic-col-actions" }] : []),
              ]}
              rows={list.map((b) => {
                const canManage = manages(me, b.tenantId);
                return {
                  key: b.id,
                  columns: [
                    {
                      content: (
                        <>
                          <span className="ic-mono">{`${b.project}/${b.instanceName}`}</span>
                          <br />
                          <span className="ic-muted">{b.clusterName ?? "removed cluster"}</span>
                        </>
                      ),
                    },
                    {
                      content: (
                        <>
                          <span>{ago(b.createdAt)}</span>
                          <br />
                          <span className="ic-muted">{b.policyId ? "scheduled" : "by hand"}</span>
                        </>
                      ),
                    },
                    { content: bytes(b.sizeBytes) },
                    { content: b.targetName ?? UNKNOWN },
                    { content: <BackupStateLabel backup={b} /> },
                    ...(showActions
                      ? [
                          {
                            className: "u-align--right",
                            content: canManage ? (
                              <div className="ic-page-controls" style={{ justifyContent: "flex-end" }}>
                                {b.state === "ready" ? (
                                  <Button className="is-small u-no-margin--bottom" onClick={() => setRestoring(b)}>
                                    Restore…
                                  </Button>
                                ) : null}
                                {b.state === "creating" ? (
                                  <Button className="is-small u-no-margin--bottom" disabled>
                                    Delete
                                  </Button>
                                ) : (
                                  <ConfirmAction
                                    label="Delete"
                                    title="Delete this backup?"
                                    className="is-small u-no-margin--bottom"
                                    onConfirm={() => act(`delete:${b.id}`, () => removeBackup(b))}
                                  >
                                    <p>The backup is removed from {b.targetName ?? "its target"}. This cannot be undone.</p>
                                  </ConfirmAction>
                                )}
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

      <h2 className="p-heading--4">Schedules</h2>
      <Loaded query={policies}>
        {(list) => {
          const showActions = list.some((p) => manages(me, p.tenantId));
          return (
            <MainTable
              emptyStateMsg="No schedules yet."
              headers={[
                { content: "Instance" },
                { content: "Target" },
                { content: "Every" },
                { content: "Keeps" },
                { content: "Last backup" },
                { content: "State" },
                ...(showActions ? [{ content: "", className: "u-align--right ic-col-actions" }] : []),
              ]}
              rows={list.map((p) => {
                const canManage = manages(me, p.tenantId);
                return {
                  key: p.id,
                  columns: [
                    { content: <span className="ic-mono">{`${p.project}/${p.instanceName}`}</span> },
                    { content: targetName(p.targetId) },
                    { content: every(p.intervalS) },
                    { content: p.keep },
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
                    { content: <span className={p.enabled ? "p-status-label--positive" : "p-status-label"}>{p.enabled ? "Active" : "Paused"}</span> },
                    ...(showActions
                      ? [
                          {
                            className: "u-align--right",
                            content: canManage ? (
                              <div className="ic-page-controls" style={{ justifyContent: "flex-end" }}>
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
                                <ConfirmAction
                                  label="Delete"
                                  title="Delete this schedule?"
                                  className="is-small u-no-margin--bottom"
                                  onConfirm={() => act(`delete:${p.id}`, () => removePolicy(p))}
                                >
                                  <p>Its backups are kept.</p>
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

      {restoring ? <RestoreBackup backup={restoring} onClose={() => setRestoring(null)} /> : null}
    </PageLayout>
  );
};

export default BackupList;
