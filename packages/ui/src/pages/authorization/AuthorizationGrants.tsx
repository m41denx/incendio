import { useState, type FC } from "react";
import {
  Button,
  ConfirmationButton,
  CustomLayout,
  EmptyState,
  Icon,
  MainTable,
  Row,
  ScrollableTable,
  SearchBox,
  Select,
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
import GrantModal from "pages/authorization/GrantModal";
import {
  useOpenFgaData,
  useOpenFgaSettings,
  useWriteTuples,
  type OpenFgaData,
} from "pages/authorization/useOpenFga";
import {
  objectName,
  objectType,
  parseSubject,
  tupleKey,
  typeLabel,
  type FgaTuple,
} from "util/openfga";

interface TableProps {
  data: OpenFgaData;
  settings: OpenFgaSettings;
  query: string;
  type: string;
}

const GrantsTable: FC<TableProps> = ({ data, settings, query, type }) => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const write = useWriteTuples(settings);
  const [revoking, setRevoking] = useState<string[]>([]);

  const revoke = (grant: FgaTuple) => {
    const key = tupleKey(grant);
    setRevoking((prev) => [...prev, key]);
    write.mutate(
      { deletes: [grant] },
      {
        onSuccess: () => {
          toastNotify.success(
            `Revoked ${grant.relation} on ${objectName(grant.object)}.`,
          );
        },
        onError: (e) => {
          toastNotify.failure(
            "Revoking access failed",
            new Error(describeOpenFgaError(e)),
          );
        },
        onSettled: () => {
          setRevoking((prev) => prev.filter((k) => k !== key));
        },
      },
    );
  };

  const needle = query.trim().toLowerCase();
  const grants = data.grants.filter((g) => {
    if (type && objectType(g.object) !== type) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const subject = parseSubject(g.user);
    return [subject?.name ?? g.user, g.relation, objectName(g.object)].some(
      (s) => s.toLowerCase().includes(needle),
    );
  });

  const headers = [
    { content: "Who", sortKey: "who" },
    { content: "Role or permission", sortKey: "relation" },
    { content: "Resource type", sortKey: "type" },
    { content: "Resource", sortKey: "object" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = grants.map((grant) => {
    const subject = parseSubject(grant.user);
    const key = tupleKey(grant);
    const type = objectType(grant.object);
    const who = subject?.name ?? grant.user;
    return {
      key,
      columns: [
        {
          content: (
            <>
              <Icon name={subject?.kind === "group" ? "user-group" : "user"} />{" "}
              {who}
              {subject?.kind === "group" && (
                <span className="u-text--muted"> (group)</span>
              )}
            </>
          ),
          role: "rowheader",
          "aria-label": "Who",
        },
        { content: grant.relation, role: "cell", "aria-label": "Role" },
        { content: typeLabel(type), role: "cell", "aria-label": "Type" },
        {
          content: objectName(grant.object),
          role: "cell",
          "aria-label": "Resource",
          title: grant.object,
        },
        {
          content: (
            <ConfirmationButton
              appearance="base"
              className="has-icon u-no-margin--bottom"
              loading={revoking.includes(key)}
              disabled={revoking.includes(key)}
              title="Revoke"
              confirmationModalProps={{
                title: "Confirm revoke",
                children: (
                  <p>
                    {subject?.kind === "group" ? "Group" : "User"}{" "}
                    <strong>{who}</strong> will lose{" "}
                    <strong>{grant.relation}</strong> on{" "}
                    <strong>{objectName(grant.object)}</strong> (
                    {typeLabel(type).toLowerCase()}). Access they have through
                    other grants or groups stays.
                  </p>
                ),
                confirmButtonLabel: "Revoke",
                onConfirm: () => {
                  revoke(grant);
                },
              }}
            >
              <Icon name="delete" />
            </ConfirmationButton>
          ),
          role: "cell",
          "aria-label": "Actions",
          className: "u-align--right actions",
        },
      ],
      sortData: {
        who: who.toLowerCase(),
        relation: grant.relation,
        type,
        object: objectName(grant.object).toLowerCase(),
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  if (data.grants.length === 0) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="user" className="empty-state-icon" />}
        title="No grants yet"
      >
        <p>
          Users routed to OpenFGA can log in but see nothing until they are
          granted a role on the server, a project or a single resource.
        </p>
      </EmptyState>
    );
  }

  return (
    <ScrollableTable
      dependencies={[grants, notify.notification]}
      tableId="openfga-grants-table"
      belowIds={["status-bar"]}
    >
      <MainTable
        id="openfga-grants-table"
        headers={headers}
        rows={sortedRows}
        sortable
        onUpdateSort={updateSort}
        emptyStateMsg="No grants match the filter."
      />
    </ScrollableTable>
  );
};

const AuthorizationGrants: FC = () => {
  const { settings } = useOpenFgaSettings();
  const { data } = useOpenFgaData(settings);
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");

  const types = [...new Set(data?.grants.map((g) => objectType(g.object)))];

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
                Grants
              </HelpLink>
            </PageHeader.Title>
            {data && (
              <PageHeader.Search>
                <SearchBox
                  className="search-box margin-right u-no-margin--bottom"
                  name="search-grants"
                  type="text"
                  onChange={(value) => {
                    setQuery(value);
                  }}
                  placeholder="Search user, group, role or resource"
                  value={query}
                  aria-label="Search grants"
                />
                <Select
                  className="u-no-margin--bottom"
                  aria-label="Resource type"
                  value={type}
                  options={[
                    { label: "All resource types", value: "" },
                    ...types
                      .sort()
                      .map((t) => ({ label: typeLabel(t), value: t })),
                  ]}
                  onChange={(e) => {
                    setType(e.target.value);
                  }}
                />
              </PageHeader.Search>
            )}
          </PageHeader.Left>
          {data && settings && (
            <PageHeader.BaseActions>
              <Button appearance="positive" hasIcon onClick={openPortal}>
                <Icon name="plus" light />
                <span>Grant access</span>
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
              <GrantsTable
                data={data}
                settings={settings}
                query={query}
                type={type}
              />
              {isOpen && (
                <Portal>
                  <GrantModal
                    data={data}
                    settings={settings}
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

export default AuthorizationGrants;
