import type { FC } from "react";
import {
  EmptyState,
  Icon,
  MainTable,
  ScrollableTable,
  Spinner,
} from "@canonical/react-components";
import useSortTableData from "util/useSortTableData";
import type { LxdAccessEntry } from "types/access";

interface Props {
  entries: LxdAccessEntry[];
  isLoading: boolean;
  error: Error | null;
  tableId: string;
}

// Friendly labels for the authorization providers Incus reports.
const providerLabels: Record<string, string> = {
  tls: "TLS",
  openfga: "OpenFGA",
  oidc: "OIDC",
  unix: "Unix socket",
};

// Read-only "who can access" table shared by the instance and project access
// panels. Incus manages OpenFGA role grants externally (not via the daemon),
// so this is intentionally view-only.
const ResourceAccessPanel: FC<Props> = ({
  entries,
  isLoading,
  error,
  tableId,
}) => {
  const headers = [
    { content: "Identifier", sortKey: "identifier" },
    { content: "Role", sortKey: "role" },
    { content: "Provider", sortKey: "provider" },
  ];

  const rows = entries.map((entry, index) => {
    const provider = providerLabels[entry.provider] ?? entry.provider;

    return {
      key: `${entry.identifier}-${entry.role}-${entry.provider}-${index}`,
      columns: [
        {
          content: <code title={entry.identifier}>{entry.identifier}</code>,
          role: "rowheader",
          "aria-label": "Identifier",
        },
        {
          content: entry.role,
          role: "cell",
          "aria-label": "Role",
        },
        {
          content: provider,
          role: "cell",
          "aria-label": "Provider",
        },
      ],
      sortData: {
        identifier: entry.identifier.toLowerCase(),
        role: entry.role.toLowerCase(),
        provider: provider.toLowerCase(),
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  if (isLoading) {
    return <Spinner className="u-loader" text="Loading access..." />;
  }

  if (error) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="security" className="empty-state-icon" />}
        title="Unable to load access"
      >
        <p>{error.message}</p>
      </EmptyState>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="user" className="empty-state-icon" />}
        title="No access entries"
      >
        <p>
          No identities currently have access, or you do not have permission to
          view them.
        </p>
      </EmptyState>
    );
  }

  return (
    <ScrollableTable
      dependencies={[entries]}
      tableId={tableId}
      belowIds={["status-bar"]}
    >
      <MainTable
        id={tableId}
        headers={headers}
        rows={sortedRows}
        sortable
        onUpdateSort={updateSort}
      />
    </ScrollableTable>
  );
};

export default ResourceAccessPanel;
