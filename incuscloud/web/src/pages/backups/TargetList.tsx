import { type FC, useState } from "react";
import { ActionButton, Button, MainTable, Notification } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import ConfirmAction from "../../components/ConfirmAction";
import { ErrorMessage, Loaded, Loading } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { BackupTarget } from "../../api/types";
import TargetForm from "./TargetForm";

interface Check {
  name: string;
  ok: boolean;
  error?: string;
}

/** Backup targets (S3 buckets). Platform staff see them; admins change them. */
const TargetList: FC = () => {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const viewer = can(me, "viewer");
  const admin = can(me, "admin");
  const targets = useQuery({
    queryKey: ["backup-targets"],
    queryFn: () => request<BackupTarget[]>("GET", "/api/v1/backup-targets"),
    enabled: viewer,
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BackupTarget | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["backup-targets"] });

  const runCheck = async (t: BackupTarget) => {
    setChecking(t.id);
    setError(null);
    try {
      const r = await request<{ ok: boolean; error?: string }>("POST", `/api/v1/backup-targets/${t.id}/check`);
      setCheck({ name: t.name, ...r });
    } catch (e) {
      setError(e);
    } finally {
      setChecking(null);
    }
  };
  const toggle = async (t: BackupTarget) => {
    setError(null);
    try {
      await request("PATCH", `/api/v1/backup-targets/${t.id}`, { enabled: !t.enabled });
      await refresh();
    } catch (e) {
      setError(e);
    }
  };
  const remove = async (t: BackupTarget) => {
    setError(null);
    await request("DELETE", `/api/v1/backup-targets/${t.id}`);
    await refresh();
  };

  return (
    <PageLayout
      title="Backup targets"
      controls={
        admin ? (
          <Button appearance="positive" onClick={() => setAdding(true)}>
            Add target
          </Button>
        ) : undefined
      }
    >
      <p className="ic-muted">S3 buckets that backups are stored in. Tenants choose among the enabled ones.</p>
      {!me ? <Loading /> : null}
      {me && !viewer ? <p>Only platform staff see backup targets.</p> : null}
      {viewer ? (
        <>
          {error ? <ErrorMessage error={error} title="Not done" /> : null}
          {check ? (
            <Notification
              severity={check.ok ? "positive" : "negative"}
              title={check.ok ? `${check.name} answers.` : `${check.name} does not answer`}
              onDismiss={() => setCheck(null)}
            >
              {check.ok ? null : check.error}
            </Notification>
          ) : null}
          <Loaded query={targets}>
            {(list) => (
              <MainTable
                emptyStateMsg="No backup targets yet."
                headers={[
                  { content: "Name" },
                  { content: "Endpoint" },
                  { content: "Bucket" },
                  { content: "Access key" },
                  { content: "State" },
                  ...(admin ? [{ content: "", className: "u-align--right ic-col-actions" }] : []),
                ]}
                rows={list.map((t) => ({
                  key: t.id,
                  columns: [
                    { content: t.name },
                    { content: <span className="ic-mono">{t.endpoint}</span> },
                    { content: t.prefix ? `${t.bucket}/${t.prefix}` : t.bucket },
                    { content: <span className="ic-mono">{t.accessKeyId}</span> },
                    { content: t.enabled ? <span className="p-status-label--positive">Enabled</span> : <span className="p-status-label">Disabled</span> },
                    ...(admin
                      ? [
                          {
                            className: "u-align--right",
                            content: (
                              <div className="ic-page-controls">
                                <ActionButton className="is-small u-no-margin--bottom" loading={checking === t.id} disabled={checking !== null} onClick={() => runCheck(t)}>
                                  Check
                                </ActionButton>
                                <Button type="button" className="is-small u-no-margin--bottom" onClick={() => setEditing(t)}>
                                  Edit…
                                </Button>
                                <Button type="button" className="is-small u-no-margin--bottom" onClick={() => toggle(t)}>
                                  {t.enabled ? "Disable" : "Enable"}
                                </Button>
                                <ConfirmAction
                                  label="Delete"
                                  title={`Delete the target ${t.name}?`}
                                  className="is-small u-no-margin--bottom"
                                  onConfirm={() => remove(t)}
                                  onError={setError}
                                >
                                  <p>Backups already in the bucket stay there.</p>
                                </ConfirmAction>
                              </div>
                            ),
                          },
                        ]
                      : []),
                  ],
                }))}
              />
            )}
          </Loaded>
        </>
      ) : null}
      {adding ? <TargetForm onClose={() => setAdding(false)} /> : null}
      {editing ? <TargetForm target={editing} onClose={() => setEditing(null)} /> : null}
    </PageLayout>
  );
};

export default TargetList;
