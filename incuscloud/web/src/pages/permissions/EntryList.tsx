import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { Input, MainTable } from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "../../api/client";
import type { AclEntry } from "../../api/types";
import ConfirmAction from "../../components/ConfirmAction";
import EmptyList from "../../components/EmptyList";
import { ErrorMessage, Loaded } from "../../components/Status";
import {
  SOURCE_LABEL,
  useAclEntries,
  useRoleName,
  useTenantList,
} from "./usePermissions";

const EDIT_LABEL = {
  users: "Users",
  tenants: "Tenants",
  "service-accounts": "Service accounts",
} as const;

/** Entries at and below `path`; explicit ones can be removed by `canManage`, the others link to the page that edits them. */
const EntryList: FC<{ path?: string; canManage: boolean }> = ({
  path = "/",
  canManage,
}) => {
  const qc = useQueryClient();
  const entries = useAclEntries(path);
  const roleName = useRoleName();
  const tenants = useTenantList().data;
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<unknown>(null);

  const editLink = (e: AclEntry) => {
    if (e.editedOn === "users") return `/users/${e.subject.id}`;
    if (e.editedOn === "tenants") {
      const slug = /^\/tenants\/([^/]+)/.exec(e.path)?.[1];
      const t = tenants?.find((x) => x.slug === slug);
      return t ? `/tenants/${t.id}` : "/tenants";
    }
    return "/service-accounts";
  };
  const remove = async (e: AclEntry) => {
    await request("DELETE", `/api/v1/acl/entries/${e.id}`);
    await qc.invalidateQueries({ queryKey: ["acl"] });
  };

  return (
    <>
      <Input
        id="acl-filter"
        type="search"
        label="Filter by path"
        placeholder="/clusters/…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {error ? <ErrorMessage error={error} /> : null}
      <Loaded query={entries}>
        {(list) => {
          const shown = list.filter((e) => e.path.includes(filter.trim()));
          return shown.length === 0 ? (
            <EmptyList icon="lock-locked" title="No entries">
              Nobody has permissions here yet.
            </EmptyList>
          ) : (
            <MainTable
              sortable
              headers={[
                { content: "Path", sortKey: "path" },
                { content: "Subject", sortKey: "subject" },
                { content: "Role", sortKey: "role" },
                { content: "Propagates" },
                { content: "Source", sortKey: "source" },
                { content: "", className: "u-align--right" },
              ]}
              rows={shown.map((e) => ({
                key: e.id,
                columns: [
                  { content: <code>{e.path}</code> },
                  { content: e.subject.name },
                  { content: roleName(e.role) },
                  { content: e.propagate ? "Yes" : "No" },
                  { content: SOURCE_LABEL[e.source] },
                  {
                    className: "u-align--right",
                    content: e.editable ? (
                      canManage ? (
                        <ConfirmAction
                          label="Remove"
                          title="Remove entry"
                          onConfirm={() => remove(e)}
                          onError={setError}
                          className="u-no-margin--bottom"
                        >
                          Remove {roleName(e.role)} on <code>{e.path}</code>{" "}
                          from {e.subject.name}?
                        </ConfirmAction>
                      ) : null
                    ) : (
                      <Link to={editLink(e)}>
                        Edit on {EDIT_LABEL[e.editedOn ?? "users"]}
                      </Link>
                    ),
                  },
                ],
                sortData: {
                  path: e.path,
                  subject: e.subject.name,
                  role: e.role,
                  source: e.source,
                },
              }))}
            />
          );
        }}
      </Loaded>
    </>
  );
};

export default EntryList;
