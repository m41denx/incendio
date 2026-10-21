import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, Button, Input, MainTable, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Section from "../../components/Section";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import type { Instance, Lease, LeasePolicy, Tenant } from "../../api/types";
import { projectPath } from "../../console/object";
import LeaseDialog, { ACTION_TEXT, days, leaseEnd } from "../instances/LeaseDialog";

interface TenantLeases {
  policy: LeasePolicy | null;
  canSet: boolean;
  leases: Array<Lease & { instanceId: string | null; cluster: string; project: string; name: string; status: string | null }>;
}

const enc = encodeURIComponent;

/**
 * A tenant's leases (permissions phase 6): its policy, set by the platform, and the leases of the
 * instances the caller sees, soonest end first.
 */
const Leases: FC<{ tenant: Tenant }> = ({ tenant }) => {
  const qc = useQueryClient();
  const key = ["tenants", tenant.id, "leases"];
  const leases = useQuery({ queryKey: key, queryFn: () => request<TenantLeases>("GET", `/api/v1/tenants/${tenant.id}/leases`) });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [opening, setOpening] = useState("");
  const [open, setOpen] = useState<Instance | null>(null);
  const changed = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["tenants", tenant.id], exact: true })]);
  const openLease = async (id: string) => {
    setOpening(id);
    setError(null);
    try {
      setOpen(await request<Instance>("GET", `/api/v1/instances/${id}`));
    } catch (e) {
      setError(e);
    } finally {
      setOpening("");
    }
  };

  return (
    <Section title="Leases" id="tenant-leases">
      <Loaded query={leases}>
        {({ policy, canSet, leases: list }) => (
          <>
            {policy ? (
              <p>
                Instances live <strong>{days(policy.days)}</strong>, then are <strong>{ACTION_TEXT[policy.action]}</strong>.{" "}
                {policy.maxExtensions === 0
                  ? "Leases cannot be extended."
                  : `Whoever may configure one can extend its lease by ${days(policy.extendDays)}, ${policy.maxExtensions === 1 ? "once" : `up to ${policy.maxExtensions} times`}.`}
              </p>
            ) : (
              <p className="u-text--muted">No lease policy: instances live until someone deletes them.</p>
            )}
            {error ? <ErrorMessage error={error} title="Not done" /> : null}
            {canSet ? (
              <div className="ic-actions">
                <Button onClick={() => setEditing(true)}>{policy ? "Edit lease policy" : "Set a lease policy"}</Button>
                {policy ? (
                  <ConfirmAction
                    label="Remove lease policy"
                    title="Remove the lease policy?"
                    onConfirm={async () => {
                      await request("PUT", `/api/v1/tenants/${tenant.id}/lease-policy`, { policy: null });
                      await changed();
                    }}
                    onError={setError}
                  >
                    <p>Every lease of {tenant.name} goes, and its instances live until deleted. A later policy gives them fresh leases.</p>
                  </ConfirmAction>
                ) : null}
              </div>
            ) : null}
            {policy ? (
              <MainTable
                emptyStateMsg="No instances with a lease yet. New ones get theirs within a minute."
                headers={[{ content: "Instance" }, { content: "Status" }, { content: "Lease" }, { content: "Extended" }, { content: "", className: "u-align--right" }]}
                rows={list.map((l) => ({
                  key: `${l.cluster}/${l.project}/${l.name}`,
                  columns: [
                    { content: <Link to={projectPath(`${l.project}@${l.cluster}`, `instance/${enc(l.name)}`)}>{`${l.name}`}</Link> },
                    { content: l.status ?? "—" },
                    {
                      content: (
                        <>
                          {leaseEnd(l)}
                          {l.expiresAt ? <span className="u-text--muted"> · {new Date(l.expiresAt).toLocaleDateString()}</span> : null}
                        </>
                      ),
                    },
                    { content: `${l.extensions} of ${l.maxExtensions}` },
                    {
                      className: "u-align--right",
                      content: l.instanceId ? (
                        <ActionButton className="u-no-margin--bottom is-small" loading={opening === l.instanceId} disabled={!!opening} onClick={() => openLease(l.instanceId!)}>
                          Lease…
                        </ActionButton>
                      ) : null,
                    },
                  ],
                }))}
              />
            ) : null}
            {editing ? <PolicyForm tenant={tenant} policy={policy} onClose={() => setEditing(false)} onSaved={changed} /> : null}
            {open ? (
              <LeaseDialog
                instance={open}
                onClose={() => {
                  setOpen(null);
                  void changed();
                }}
              />
            ) : null}
          </>
        )}
      </Loaded>
    </Section>
  );
};

const PolicyForm: FC<{ tenant: Tenant; policy: LeasePolicy | null; onClose: () => void; onSaved: () => Promise<unknown> }> = ({ tenant, policy, onClose, onSaved }) => {
  const [f, setF] = useState({
    days: String(policy?.days ?? 30),
    action: policy?.action ?? "stop",
    extendDays: String(policy?.extendDays ?? 14),
    maxExtensions: String(policy?.maxExtensions ?? 3),
  });
  const n = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
  const valid = n(f.days) >= 1 && n(f.extendDays) >= 1 && n(f.maxExtensions) >= 0;
  return (
    <FormModal
      title={`Lease policy of ${tenant.name}`}
      submitLabel="Save"
      submitDisabled={!valid}
      onClose={onClose}
      onSubmit={async () => {
        await request("PUT", `/api/v1/tenants/${tenant.id}/lease-policy`, {
          policy: { days: n(f.days), action: f.action, extendDays: n(f.extendDays), maxExtensions: n(f.maxExtensions) },
        });
        await onSaved();
      }}
    >
      <p className="u-text--muted">
        Every instance of the tenant gets a lease when IncusCloud first sees it, existing ones included. Changing the policy keeps the leases already given.
      </p>
      <Input id="lease-days" type="number" min={1} label="Lease (days)" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
      <Select
        id="lease-action"
        label="When it ends"
        value={f.action}
        options={[
          { value: "stop", label: "Stop the instance (and keep it stopped)" },
          { value: "delete", label: "Delete the instance" },
        ]}
        onChange={(e) => setF({ ...f, action: e.target.value as LeasePolicy["action"] })}
      />
      <Input id="lease-extend-days" type="number" min={1} label="Each extension (days)" value={f.extendDays} onChange={(e) => setF({ ...f, extendDays: e.target.value })} />
      <Input id="lease-max-extensions" type="number" min={0} label="Extensions allowed" value={f.maxExtensions} onChange={(e) => setF({ ...f, maxExtensions: e.target.value })} />
    </FormModal>
  );
};

export default Leases;
