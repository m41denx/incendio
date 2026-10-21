import { type FC, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@canonical/react-components";
import PageLayout from "../../components/PageLayout";
import { canAtRoot, useMe } from "../../api/hooks";
import EntryList from "./EntryList";
import AddEntryModal from "./AddEntryModal";
import RoleList from "./RoleList";
import CheckForm from "./CheckForm";

const TABS = [
  { id: "", label: "Entries" },
  { id: "roles", label: "Roles" },
  { id: "check", label: "Check" },
];

/** Platform › Permissions: who holds which role where, the roles, and a check. */
const PermissionsPage: FC = () => {
  const { tab = "" } = useParams();
  const { data: me } = useMe();
  const [adding, setAdding] = useState(false);
  const canManage = canAtRoot(me, "acl.manage");
  return (
    <PageLayout
      title="Permissions"
      controls={
        tab === "" && canManage ? (
          <Button appearance="positive" onClick={() => setAdding(true)}>
            Add entry
          </Button>
        ) : undefined
      }
    >
      <nav className="p-tabs" aria-label="Permissions">
        <ul className="p-tabs__list">
          {TABS.map((t) => (
            <li key={t.id} className="p-tabs__item">
              <Link
                className="p-tabs__link"
                to={t.id ? `/permissions/${t.id}` : "/permissions"}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "roles" ? (
        <RoleList />
      ) : tab === "check" ? (
        <CheckForm />
      ) : (
        <EntryList canManage={canManage} />
      )}
      {adding ? <AddEntryModal onClose={() => setAdding(false)} /> : null}
    </PageLayout>
  );
};

export default PermissionsPage;
