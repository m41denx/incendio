import { type FC, useState } from "react";
import { Button, Input, MainTable, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import type { Member, Tenant, TenantRole } from "../../api/types";
import { TENANT_ROLE_HELP, assignableRoles, roleName } from "./roles";
import Section from "../../components/Section";

interface Props {
  tenant: Tenant;
  /** Tenant owners/admins and platform admins. */
  canManage: boolean;
  /** Owners and platform admins: may grant and change the owner role. */
  ownerPower: boolean;
}

const Members: FC<Props> = ({ tenant, canManage, ownerPower }) => {
  const qc = useQueryClient();
  const key = ["tenants", tenant.id, "members"];
  const members = useQuery({ queryKey: key, queryFn: () => request<Member[]>("GET", `/api/v1/tenants/${tenant.id}/members`) });
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("member");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["me"] })]);
  const setMemberRole = async (m: Member, next: TenantRole) => {
    setError(null);
    try {
      await request("PUT", `/api/v1/tenants/${tenant.id}/members/${m.userId}`, { role: next });
    } catch (e) {
      setError(e);
    }
    await refresh();
  };
  const roles = assignableRoles(ownerPower);

  return (
    <Section title="Members" id="tenant-members">
      {error ? <ErrorMessage error={error} title="Not changed" /> : null}
      <Loaded query={members}>
        {(list) => (
          <MainTable
            emptyStateMsg="No members yet."
            headers={[{ content: "Email" }, { content: "Name" }, { content: "Role" }, ...(canManage ? [{ content: "", className: "u-align--right" }] : [])]}
            rows={list.map((m) => {
              // Changing an owner, or making one, needs owner power.
              const editable = canManage && (ownerPower || m.role !== "owner");
              return {
                key: m.userId,
                columns: [
                  { content: m.email },
                  { content: m.name },
                  {
                    content: editable ? (
                      <Select
                        aria-label={`Role of ${m.email}`}
                        wrapperClassName="u-no-margin--bottom"
                        value={m.role}
                        onChange={(e) => void setMemberRole(m, e.target.value as TenantRole)}
                        options={(roles.includes(m.role) ? roles : [m.role, ...roles]).map((r) => ({ value: r, label: roleName(r) }))}
                      />
                    ) : (
                      roleName(m.role)
                    ),
                  },
                  ...(canManage
                    ? [
                        {
                          className: "u-align--right",
                          content: editable ? (
                            <ConfirmAction
                              label="Remove"
                              title={`Remove ${m.email}?`}
                              className="is-small u-no-margin--bottom"
                              onConfirm={async () => {
                                await request("DELETE", `/api/v1/tenants/${tenant.id}/members/${m.userId}`);
                                await refresh();
                              }}
                              onError={setError}
                            >
                              <p>They lose access to {tenant.slug} on every cluster within seconds.</p>
                            </ConfirmAction>
                          ) : null,
                        },
                      ]
                    : []),
                ],
              };
            })}
          />
        )}
      </Loaded>
      {canManage ? <Button onClick={() => setAdding(true)}>Add member</Button> : null}
      {adding ? (
        <FormModal
          title={`Add a member to ${tenant.slug}`}
          submitLabel="Add"
          onClose={() => {
            setAdding(false);
            setEmail("");
            setRole("member");
          }}
          onSubmit={async () => {
            await request("POST", `/api/v1/tenants/${tenant.id}/members`, { email: email.trim(), role });
            await refresh();
          }}
          submitDisabled={!email.trim()}
        >
          <Input id="member-email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} help="The person needs an IncusCloud account; a platform administrator creates it." />
          <Select id="member-role" label="Role" value={role} onChange={(e) => setRole(e.target.value as TenantRole)} options={roles.map((r) => ({ value: r, label: TENANT_ROLE_HELP[r] }))} />
        </FormModal>
      ) : null}
    </Section>
  );
};

export default Members;
