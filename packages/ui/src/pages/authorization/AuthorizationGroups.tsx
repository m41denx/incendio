import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  Chip,
  ConfirmationButton,
  CustomLayout,
  EmptyState,
  Icon,
  Input,
  MainTable,
  Modal,
  Row,
  ScrollableTable,
  usePortal,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import useSortTableData from "util/useSortTableData";
import { describeOpenFgaError, type OpenFgaSettings } from "api/openfga";
import OpenFgaGate from "pages/authorization/OpenFgaGate";
import {
  useOpenFgaData,
  useOpenFgaSettings,
  useWriteTuples,
  type OpenFgaData,
} from "pages/authorization/useOpenFga";
import {
  objectName,
  parseSubject,
  subjectUser,
  type FgaTuple,
} from "util/openfga";

const membership = (user: string, group: string): FgaTuple => ({
  user: subjectUser({ kind: "user", name: user }),
  relation: "member",
  object: `group:${group}`,
});

const invalidName = (name: string) => /[\s#:]/.test(name);

interface ModalProps {
  data: OpenFgaData;
  settings: OpenFgaSettings;
  group?: string;
  close: () => void;
}

const AddMemberModal: FC<ModalProps> = ({ data, settings, group, close }) => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const write = useWriteTuples(settings);
  const [groupName, setGroupName] = useState(group ?? "");
  const [user, setUser] = useState("");

  const g = groupName.trim();
  const u = user.trim();
  const tuple = membership(u, g);
  const exists = data.memberships.some(
    (m) => m.user === tuple.user && m.object === tuple.object,
  );
  const disabled =
    !g || !u || invalidName(g) || /[\s#]/.test(u) || exists || write.isPending;

  const submit = () => {
    write.mutate(
      { writes: [tuple] },
      {
        onSuccess: () => {
          toastNotify.success(`Added ${u} to group ${g}.`);
          close();
        },
        onError: (e) => {
          notify.failure(
            "Adding the member failed",
            new Error(describeOpenFgaError(e)),
          );
        },
      },
    );
  };

  return (
    <Modal
      close={close}
      title={group ? `Add member to ${group}` : "Add user to group"}
      buttonRow={
        <>
          <Button
            appearance="base"
            className="u-no-margin--bottom"
            onClick={close}
            type="button"
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={write.isPending}
            disabled={disabled}
            onClick={submit}
            type="button"
          >
            Add
          </ActionButton>
        </>
      }
    >
      {!group && (
        <>
          <Input
            type="text"
            label="Group"
            help="An existing group, or a new name to create the group."
            value={groupName}
            list="openfga-groups"
            onChange={(e) => {
              setGroupName(e.target.value);
            }}
            error={
              g && invalidName(g)
                ? "Group names cannot contain spaces, # or :"
                : undefined
            }
            autoComplete="off"
            takeFocus
          />
          <datalist id="openfga-groups">
            {data.groups.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      )}
      <Input
        type="text"
        label="User name"
        help="As Incus sees it: the OIDC claim set in oidc.claim (else email, else sub), or the TLS certificate's name or fingerprint."
        value={user}
        list="openfga-users"
        onChange={(e) => {
          setUser(e.target.value);
        }}
        error={exists ? "Already a member." : undefined}
        autoComplete="off"
        takeFocus={!!group}
      />
      <datalist id="openfga-users">
        {data.users.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Modal>
  );
};

interface TableProps {
  data: OpenFgaData;
  settings: OpenFgaSettings;
  onAdd: (group: string) => void;
}

const GroupsTable: FC<TableProps> = ({ data, settings, onAdd }) => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const write = useWriteTuples(settings);
  const [busy, setBusy] = useState<string[]>([]);

  const run = (
    key: string,
    change: { writes?: FgaTuple[]; deletes?: FgaTuple[] },
    success: string,
    failure: string,
  ) => {
    setBusy((prev) => [...prev, key]);
    write.mutate(change, {
      onSuccess: () => {
        toastNotify.success(success);
      },
      onError: (e) => {
        toastNotify.failure(failure, new Error(describeOpenFgaError(e)));
      },
      onSettled: () => {
        setBusy((prev) => prev.filter((k) => k !== key));
      },
    });
  };

  const groupGrants = (group: string) =>
    data.grants.filter((g) => g.user === `group:${group}#member`);
  const members = (group: string) =>
    data.memberships.filter((m) => m.object === `group:${group}`);

  const headers = [
    { content: "Group", sortKey: "name" },
    { content: "Members" },
    { content: "Grants", sortKey: "grants", className: "u-align--right" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = data.groups.map((group) => {
    const groupMembers = members(group);
    const grants = groupGrants(group);
    return {
      key: group,
      columns: [
        { content: group, role: "rowheader", "aria-label": "Group" },
        {
          content:
            groupMembers.length === 0 ? (
              <span className="u-text--muted">No members</span>
            ) : (
              groupMembers.map((m) => {
                const name = parseSubject(m.user)?.name ?? m.user;
                const key = `${group}|${m.user}`;
                return (
                  <Chip
                    key={m.user}
                    value={name}
                    isDense
                    isInline
                    isReadOnly={busy.includes(key)}
                    onDismiss={() => {
                      run(
                        key,
                        { deletes: [m] },
                        `Removed ${name} from group ${group}.`,
                        "Removing the member failed",
                      );
                    }}
                  />
                );
              })
            ),
          role: "cell",
          "aria-label": "Members",
        },
        {
          content: grants.length,
          role: "cell",
          className: "u-align--right",
          "aria-label": "Grants",
          title: grants
            .map((g) => `${g.relation} on ${objectName(g.object)}`)
            .join("\n"),
        },
        {
          content: (
            <>
              <Button
                appearance="base"
                className="has-icon u-no-margin--bottom"
                title="Add member"
                onClick={() => {
                  onAdd(group);
                }}
              >
                <Icon name="plus" />
              </Button>
              <ConfirmationButton
                appearance="base"
                className="has-icon u-no-margin--bottom"
                loading={busy.includes(group)}
                disabled={busy.includes(group)}
                title="Delete group"
                confirmationModalProps={{
                  title: "Confirm delete",
                  children: (
                    <p>
                      Group <strong>{group}</strong> will be removed with its{" "}
                      {groupMembers.length} memberships and {grants.length}{" "}
                      grants. Its members lose the access they had through it.
                    </p>
                  ),
                  confirmButtonLabel: "Delete",
                  onConfirm: () => {
                    run(
                      group,
                      { deletes: [...groupMembers, ...grants] },
                      `Group ${group} deleted.`,
                      "Deleting the group failed",
                    );
                  },
                }}
              >
                <Icon name="delete" />
              </ConfirmationButton>
            </>
          ),
          role: "cell",
          "aria-label": "Actions",
          className: "u-align--right actions",
        },
      ],
      sortData: { name: group.toLowerCase(), grants: grants.length },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  if (data.groups.length === 0) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="user-group" className="empty-state-icon" />}
        title="No groups yet"
      >
        <p>
          A group exists once it has a member. Grant roles to a group on the
          Grants page and every member gets them.
        </p>
      </EmptyState>
    );
  }

  return (
    <ScrollableTable
      dependencies={[data.groups, notify.notification]}
      tableId="openfga-groups-table"
      belowIds={["status-bar"]}
    >
      <MainTable
        id="openfga-groups-table"
        headers={headers}
        rows={sortedRows}
        sortable
        onUpdateSort={updateSort}
      />
    </ScrollableTable>
  );
};

const AuthorizationGroups: FC = () => {
  const { settings } = useOpenFgaSettings();
  const { data } = useOpenFgaData(settings);
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  const [group, setGroup] = useState<string | undefined>();

  const open = (name?: string) => {
    setGroup(name);
    openPortal();
  };

  return (
    <CustomLayout
      contentClassName="u-no-padding--bottom"
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/authorization/"
                title="Learn more about authorization"
              >
                Groups
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
          {data && settings && (
            <PageHeader.BaseActions>
              <Button
                appearance="positive"
                hasIcon
                onClick={() => {
                  open();
                }}
              >
                <Icon name="plus" light />
                <span>Add user to group</span>
              </Button>
            </PageHeader.BaseActions>
          )}
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        <OpenFgaGate>
          {(data, settings) => (
            <>
              <GroupsTable data={data} settings={settings} onAdd={open} />
              {isOpen && (
                <Portal>
                  <AddMemberModal
                    data={data}
                    settings={settings}
                    group={group}
                    close={closePortal}
                  />
                </Portal>
              )}
            </>
          )}
        </OpenFgaGate>
      </Row>
    </CustomLayout>
  );
};

export default AuthorizationGroups;
