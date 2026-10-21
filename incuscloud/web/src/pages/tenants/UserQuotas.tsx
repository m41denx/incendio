import { type FC, useState } from "react";
import { Button, Input, MainTable, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import Section from "../../components/Section";
import { Loaded } from "../../components/Status";
import { request } from "../../api/client";
import type { Member, Tenant, UserQuotaRow, UserQuotas as Quotas } from "../../api/types";

type Key = keyof Quotas;
const FIELDS: Array<{ key: Key; label: string }> = [
  { key: "instances", label: "Instances" },
  { key: "cpu", label: "CPUs" },
  { key: "memory", label: "Memory (GiB)" },
  { key: "backups", label: "Backups" },
];
const GiB = 1024 ** 3;
const shown = (k: Key, used: number, cap: number | undefined) => `${k === "memory" ? (used / GiB).toFixed(1) : used}${cap === undefined ? "" : ` of ${cap}`}`;

/**
 * Users' shares of the tenant's quota (permissions phase 4): what each member
 * may own, set by the tenant's admins and never above the tenant's own.
 * Members without a row have no limit of their own.
 */
const UserQuotas: FC<{ tenant: Tenant; canManage: boolean }> = ({ tenant, canManage }) => {
  const qc = useQueryClient();
  const key = ["tenants", tenant.id, "user-quotas"];
  const rows = useQuery({ queryKey: key, queryFn: () => request<UserQuotaRow[]>("GET", `/api/v1/tenants/${tenant.id}/user-quotas`) });
  const members = useQuery({ queryKey: ["tenants", tenant.id, "members"], enabled: canManage, queryFn: () => request<Member[]>("GET", `/api/v1/tenants/${tenant.id}/members`) });
  const [editing, setEditing] = useState<{ userId: string; draft: Record<Key, string> } | null>(null);

  const open = (userId: string, q: Quotas = {}) => setEditing({ userId, draft: Object.fromEntries(FIELDS.map((f) => [f.key, q[f.key]?.toString() ?? ""])) as Record<Key, string> });
  const valid = (d: Record<Key, string>) => Object.values(d).every((v) => v.trim() === "" || /^\d+$/.test(v.trim()));

  return (
    <Section title="Users' quotas" id="tenant-user-quotas">
      <p className="u-text--muted">What one member may own here: instances they created and backups they made. Empty means only the tenant's quota applies.</p>
      <Loaded query={rows}>
        {(list) => (
          <MainTable
            emptyStateMsg="No member has a quota of their own."
            headers={[{ content: "Member" }, ...FIELDS.map((f) => ({ content: f.label })), { content: "", className: "u-align--right" }]}
            rows={list.map((r) => ({
              key: r.userId,
              columns: [
                { content: r.email },
                ...FIELDS.map((f) => ({ content: shown(f.key, r.used[f.key], r.quotas[f.key]) })),
                {
                  className: "u-align--right",
                  content: canManage ? (
                    <Button className="u-no-margin--bottom" onClick={() => open(r.userId, r.quotas)}>
                      Edit
                    </Button>
                  ) : null,
                },
              ],
            }))}
          />
        )}
      </Loaded>
      {canManage ? <Button onClick={() => open("")}>Set a member's quota</Button> : null}
      {editing ? (
        <FormModal
          title="Member's quota"
          submitLabel="Save"
          submitDisabled={!editing.userId || !valid(editing.draft)}
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            const quotas = Object.fromEntries(Object.entries(editing.draft).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));
            await request("PUT", `/api/v1/tenants/${tenant.id}/user-quotas/${editing.userId}`, { quotas });
            await qc.invalidateQueries({ queryKey: key });
          }}
        >
          <Select
            id="user-quota-member"
            label="Member"
            value={editing.userId}
            onChange={(e) => setEditing({ ...editing, userId: e.target.value })}
            options={[{ value: "", label: "Choose…", disabled: true }, ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.email }))]}
          />
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              id={`user-quota-${f.key}`}
              label={f.label}
              type="number"
              min={0}
              step={1}
              value={editing.draft[f.key]}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, [f.key]: e.target.value } })}
              help={tenant.quotas[f.key] !== undefined ? `The tenant's: ${tenant.quotas[f.key]}` : undefined}
            />
          ))}
          <p className="u-text--muted">Clear every field to remove the member's quota.</p>
        </FormModal>
      ) : null}
    </Section>
  );
};

export default UserQuotas;
