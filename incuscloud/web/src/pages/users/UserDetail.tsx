import { type FC, type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActionButton, Button, Form, Input, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { User } from "../../api/types";
import { PLATFORM_ROLE_OPTIONS, roleLabel, toRole } from "./roles";
import Section from "../../components/Section";

const UserDetail: FC = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useQuery({ queryKey: ["users", id], queryFn: () => request<User>("GET", `/api/v1/users/${id}`) });
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const admin = can(me, "admin");

  useEffect(() => {
    if (user.data) {
      setName(user.data.name);
      setRole(user.data.platformRole ?? "");
    }
  }, [user.data]);

  const patch = async (body: Partial<Pick<User, "name" | "platformRole" | "disabled">> & { password?: string }) => {
    setError(null);
    const updated = await request<User>("PATCH", `/api/v1/users/${id}`, body);
    qc.setQueryData(["users", id], updated);
    await qc.invalidateQueries({ queryKey: ["users"], exact: true });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await patch({ name, platformRole: toRole(role) });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout title={<>
      <Link to="/users">Users</Link> / {user.data?.name ?? "…"}
    </>}>
      {error ? <ErrorMessage error={error} title="Not saved" /> : null}
      <Loaded query={user}>
        {(u) => (
          <>
            <Section title="General" id="user-general">
            <KeyValues
              items={[
                ["Email", u.email],
                ["Platform role", roleLabel(u.platformRole)],
                ["Status", u.disabled ? "Disabled" : "Active"],
                ["Sign-in", u.hasPassword ? "Password" : "Identity provider"],
                ["Created", new Date(u.createdAt).toLocaleString()],
                ["Last sign-in", ago(u.lastLoginAt)],
              ]}
            />
            </Section>
            {admin ? (
              <>
                <Section title="Edit" id="user-edit">
                <Form onSubmit={save} style={{ maxWidth: "36rem" }}>
                  <Input id="edit-name" label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                  <Select id="edit-role" label="Platform role" options={PLATFORM_ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} />
                  <ActionButton appearance="positive" type="submit" loading={saving} disabled={!name || saving}>
                    Save
                  </ActionButton>
                </Form>
                </Section>
                <Section title="Access" id="user-access">
                <div className="ic-actions">
                  {u.disabled ? (
                    <Button onClick={() => patch({ disabled: false }).catch(setError)}>Enable</Button>
                  ) : (
                    <ConfirmAction label="Disable" appearance="base" title={`Disable ${u.name}?`} onConfirm={() => patch({ disabled: true })} onError={setError}>
                      <p>They are signed out everywhere, and their tokens stop working on every cluster.</p>
                    </ConfirmAction>
                  )}
                  <Button onClick={() => setSettingPassword(true)}>{u.hasPassword ? "Reset password" : "Set password"}</Button>
                  <ConfirmAction
                    label="Delete"
                    title={`Delete ${u.name}?`}
                    onConfirm={async () => {
                      await request("DELETE", `/api/v1/users/${id}`);
                      await qc.invalidateQueries({ queryKey: ["users"] });
                      navigate("/users");
                    }}
                    onError={setError}
                  >
                    <p>
                      This removes <strong>{u.email}</strong>, their tenant memberships and their access to every cluster. It cannot be undone.
                    </p>
                  </ConfirmAction>
                </div>
                </Section>
              </>
            ) : null}
          </>
        )}
      </Loaded>
      {settingPassword ? (
        <FormModal
          title="Set password"
          submitLabel="Set password"
          onSubmit={() => patch({ password })}
          onClose={() => {
            setSettingPassword(false);
            setPassword("");
          }}
          submitDisabled={password.length < 12}
        >
          <Input id="new-password" label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} help="At least 12 characters." />
        </FormModal>
      ) : null}
    </PageLayout>
  );
};

export default UserDetail;
