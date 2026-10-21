import type { FC } from "react";
import { MainTable } from "@canonical/react-components";
import { Loaded } from "../../components/Status";
import { useAclRoles } from "./usePermissions";

/** The bundled roles and what each allows. */
const RoleList: FC = () => {
  const roles = useAclRoles();
  return (
    <Loaded query={roles}>
      {(list) => (
        <MainTable
          headers={[{ content: "Role" }, { content: "Privileges" }]}
          rows={list.map((r) => ({
            key: r.id,
            columns: [
              { content: r.name },
              {
                content: (
                  <>
                    {r.privileges.length ? r.privileges.join(", ") : "Nothing"}
                    {r.ownedOnly?.length ? (
                      <p className="p-text--small u-text--muted u-no-margin--bottom">
                        Only on what they own: {r.ownedOnly.join(", ")}
                      </p>
                    ) : null}
                  </>
                ),
              },
            ],
          }))}
        />
      )}
    </Loaded>
  );
};

export default RoleList;
