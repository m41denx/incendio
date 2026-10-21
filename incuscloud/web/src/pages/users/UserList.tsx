import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { Button, MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { User } from "../../api/types";
import CreateUser from "./CreateUser";
import { roleLabel } from "./roles";
import EmptyList from "../../components/EmptyList";

const UserList: FC = () => {
  const { data: me } = useMe();
  const users = useQuery({ queryKey: ["users"], queryFn: () => request<User[]>("GET", "/api/v1/users") });
  const [creating, setCreating] = useState(false);
  return (
    <PageLayout
      title="Users"
      controls={
        can(me, "admin") ? (
          <Button appearance="positive" onClick={() => setCreating(true)}>
            Create user
          </Button>
        ) : undefined
      }
    >
      <Loaded query={users}>
        {(list) =>
          list.length === 0 ? (
            <EmptyList icon="user-group" title="No users found">No users yet.</EmptyList>
          ) : (
          <MainTable
            sortable
            headers={[
              { content: "Name", sortKey: "name" },
              { content: "Email", sortKey: "email" },
              { content: "Platform role", sortKey: "role" },
              { content: "Status", sortKey: "status" },
              { content: "Sign-in" },
              { content: "Last sign-in", sortKey: "last" },
            ]}
            rows={list.map((u) => ({
              key: u.id,
              columns: [
                { content: <Link to={`/users/${u.id}`}>{u.name}</Link> },
                { content: u.email },
                { content: roleLabel(u.platformRole) },
                { content: u.disabled ? "Disabled" : "Active" },
                { content: u.hasPassword ? "Password" : "Identity provider" },
                { content: ago(u.lastLoginAt) },
              ],
              sortData: { name: u.name.toLowerCase(), email: u.email, role: u.platformRole ?? "", status: u.disabled ? 1 : 0, last: u.lastLoginAt ?? "" },
            }))}
          />
        )}
      </Loaded>
      {creating ? <CreateUser onClose={() => setCreating(false)} /> : null}
    </PageLayout>
  );
};

export default UserList;
