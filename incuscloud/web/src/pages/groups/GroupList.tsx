import { type FC, useState } from "react";
import { Button, Input, MainTable, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import PageLayout from "../../components/PageLayout";
import ConfirmAction from "../../components/ConfirmAction";
import EmptyList from "../../components/EmptyList";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import { canAtRoot, useMe } from "../../api/hooks";
import { useSubjects } from "../permissions/usePermissions";

export interface Group {
  id: string;
  name: string;
  description: string;
  /** `provider`: an identity provider's mapping added them; their next sign-in there decides again. */
  members: Array<{ type: "user" | "service"; id: string; name: string; provider?: string }>;
}

export const useGroups = () => useQuery({ queryKey: ["groups"], queryFn: () => request<Group[]>("GET", "/api/v1/groups") });

/**
 * Platform › Groups: IncusCloud's groups of users and service accounts, for
 * permission entries. Each tenant's default group (`<tenant>/members`) is
 * not listed: it is always the tenant's members.
 */
const GroupList: FC = () => {
  const { data: me } = useMe();
  const manage = canAtRoot(me, "platform.users");
  const qc = useQueryClient();
  const groups = useGroups();
  const subjects = useSubjects();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState<Group | null>(null);
  const [member, setMember] = useState("");
  const [error, setError] = useState<unknown>(null);
  const changed = () => Promise.all([qc.invalidateQueries({ queryKey: ["groups"] }), qc.invalidateQueries({ queryKey: ["acl"] })]);

  return (
    <PageLayout
      title="Groups"
      controls={
        manage ? (
          <Button appearance="positive" onClick={() => setCreating(true)}>
            Create group
          </Button>
        ) : undefined
      }
    >
      <p className="u-text--muted">
        Users and service accounts that permission entries name together. Each tenant also has a default group, <code>&lt;tenant&gt;/members</code>, that always holds its members and service accounts. Identity providers can add their users to groups by their groups claim: see <Link to="/identity-providers">Identity providers</Link>.
      </p>
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      <Loaded query={groups}>
        {(list) =>
          list.length === 0 ? (
            <EmptyList icon="user-group" title="No groups">
              Create one to give several people the same permissions.
            </EmptyList>
          ) : (
            <MainTable
              headers={[{ content: "Name" }, { content: "Description" }, { content: "Members" }, { content: "", className: "u-align--right" }]}
              rows={list.map((g) => ({
                key: g.id,
                columns: [
                  { content: g.name },
                  { content: g.description },
                  {
                    content: g.members.length ? (
                      <ul className="p-list u-no-margin--bottom">
                        {g.members.map((m) => (
                          <li key={`${m.type}:${m.id}`} className="p-list__item">
                            {m.name}
                            {m.type === "service" ? " (service account)" : ""}
                            {m.provider ? <span className="u-text--muted"> (from {m.provider})</span> : null}
                            {manage ? (
                              <>
                                {" "}
                                <ConfirmAction label="Remove" title="Remove member" appearance="base" onConfirm={async () => {
                                  await request("DELETE", `/api/v1/groups/${g.id}/members/${m.type}/${m.id}`);
                                  await changed();
                                }} onError={setError} className="u-no-margin--bottom">
                                  Remove {m.name} from {g.name}?
                                  {m.provider ? ` ${m.provider}'s mapping adds them again at their next sign-in there.` : ""}
                                </ConfirmAction>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "Nobody"
                    ),
                  },
                  {
                    className: "u-align--right",
                    content: manage ? (
                      <>
                        <Button className="u-no-margin--bottom" onClick={() => { setAdding(g); setMember(""); }}>
                          Add member
                        </Button>
                        <ConfirmAction label="Delete" title="Delete group" onConfirm={async () => {
                          await request("DELETE", `/api/v1/groups/${g.id}`);
                          await changed();
                        }} onError={setError} className="u-no-margin--bottom">
                          Delete {g.name}? Its permission entries go with it.
                        </ConfirmAction>
                      </>
                    ) : null,
                  },
                ],
              }))}
            />
          )
        }
      </Loaded>
      {creating ? (
        <FormModal
          title="Create group"
          submitLabel="Create"
          submitDisabled={!name}
          onClose={() => { setCreating(false); setName(""); setDescription(""); }}
          onSubmit={async () => {
            await request("POST", "/api/v1/groups", { name, description });
            await changed();
          }}
        >
          <Input id="group-name" type="text" label="Name" value={name} onChange={(e) => setName(e.target.value)} help="Lower case letters, digits, dots, dashes and underscores." />
          <Input id="group-description" type="text" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormModal>
      ) : null}
      {adding ? (
        <FormModal
          title={`Add a member to ${adding.name}`}
          submitLabel="Add"
          submitDisabled={!member}
          onClose={() => setAdding(null)}
          onSubmit={async () => {
            const [type, id] = member.split(":");
            await request("PUT", `/api/v1/groups/${adding.id}/members/${type}/${id}`);
            await changed();
          }}
        >
          <Select
            id="group-member"
            label="User or service account"
            value={member}
            onChange={(e) => setMember(e.target.value)}
            options={[{ value: "", label: "Choose…", disabled: true }, ...subjects.filter((s) => s.value.startsWith("user:") || s.value.startsWith("service:"))]}
          />
        </FormModal>
      ) : null}
    </PageLayout>
  );
};

export default GroupList;
