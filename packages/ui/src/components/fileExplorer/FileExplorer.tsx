import type { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Icon,
  MainTable,
  Notification,
  ScrollableTable,
  Spinner,
} from "@canonical/react-components";
import type {
  MainTableHeader,
  MainTableRow,
} from "@canonical/react-components/dist/components/MainTable/MainTable";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDirectory,
  fetchFileMetadata,
  fileUrl,
  type FileMetadata,
  type FileTarget,
} from "api/files";
import { isoTimeToString } from "util/helpers";
import { joinPath, parseFileModified } from "util/fileExplorer";
import useSortTableData from "util/useSortTableData";
import FileExplorerBreadcrumb from "components/fileExplorer/FileExplorerBreadcrumb";
import FileDeleteButton from "components/fileExplorer/FileDeleteButton";
import FileUploadButton from "components/fileExplorer/FileUploadButton";
import NewFolderButton from "components/fileExplorer/NewFolderButton";

interface Props {
  target: FileTarget;
  /** Query-key prefix for this resource's files; invalidated after changes. */
  queryKey: readonly unknown[];
  currentPath: string;
  /** In-app URL of a directory, so navigation lives in the address bar. */
  directoryLink: (path: string) => string;
  /** Rich chip of the instance or volume, for toasts. */
  owner: ReactNode;
  /** Set when the user may not change files (upload, new folder, delete). */
  writeDisabledReason?: string;
}

const ENTRY_ICON: Record<string, string> = {
  directory: "folder",
  file: "file-blank",
  symlink: "get-link",
};

const EntryName: FC<{
  name: string;
  path: string;
  metadata?: FileMetadata;
  target: FileTarget;
  directoryLink: (path: string) => string;
}> = ({ name, path, metadata, target, directoryLink }) => {
  const type = metadata?.type;
  const label = (
    <>
      <Icon name={ENTRY_ICON[type ?? ""] ?? "file-blank"} />
      <span>{name}</span>
    </>
  );
  if (type === "directory") {
    return (
      <Link to={directoryLink(path)} className="file-explorer-item">
        {label}
      </Link>
    );
  }
  if (type === "file") {
    return (
      <a
        href={fileUrl(target, path)}
        download={name}
        className="file-explorer-item"
        title={`Download ${name}`}
      >
        {label}
      </a>
    );
  }
  // Symlinks (the API returns the link's target path, not the file) and
  // entries whose metadata is still loading.
  return <span className="file-explorer-item">{label}</span>;
};

const FileExplorer: FC<Props> = ({
  target,
  queryKey,
  currentPath,
  directoryLink,
  owner,
  writeDisabledReason,
}) => {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  };

  const {
    data: names = [],
    error,
    isLoading,
  } = useQuery({
    queryKey: [...queryKey, "list", currentPath],
    queryFn: async () => fetchDirectory(target, currentPath),
  });

  const metadata = useQueries({
    queries: names.map((name) => ({
      queryKey: [...queryKey, "metadata", joinPath(currentPath, name)],
      queryFn: async () =>
        fetchFileMetadata(target, joinPath(currentPath, name)),
    })),
  });

  const headers: MainTableHeader[] = [
    { content: "Name", sortKey: "name" },
    { content: "Type", sortKey: "type" },
    { content: "Mode", className: "u-hide--small" },
    { content: "Modified", sortKey: "modified" },
    { "aria-label": "Actions", className: "actions u-align--right" },
  ];

  const rows: MainTableRow[] = names.map((name, index) => {
    const path = joinPath(currentPath, name);
    const meta = metadata[index]?.data;
    const modified = parseFileModified(meta?.modified ?? null);
    const type = meta?.type ?? "-";
    return {
      key: name,
      className: "u-row",
      columns: [
        {
          content: (
            <EntryName
              name={name}
              path={path}
              metadata={meta}
              target={target}
              directoryLink={directoryLink}
            />
          ),
          role: "rowheader",
          "aria-label": "Name",
        },
        { content: type, role: "cell", "aria-label": "Type" },
        {
          content: meta?.mode ?? "-",
          role: "cell",
          "aria-label": "Mode",
          className: "u-hide--small",
        },
        {
          content: modified ? isoTimeToString(modified.toISOString()) : "-",
          role: "cell",
          "aria-label": "Modified",
        },
        {
          content: meta ? (
            <FileDeleteButton
              target={target}
              path={path}
              isDirectory={meta.type === "directory"}
              owner={owner}
              disabledReason={writeDisabledReason}
              onDeleted={refresh}
            />
          ) : null,
          role: "cell",
          className: "u-align--right",
          "aria-label": "Actions",
        },
      ],
      sortData: {
        // Directories first, then by name.
        name: `${meta?.type === "directory" ? 0 : 1}${name.toLowerCase()}`,
        type,
        modified: modified?.getTime() ?? 0,
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({
    rows,
    defaultSort: "name",
  });

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <FileExplorerBreadcrumb
          currentPath={currentPath}
          directoryLink={directoryLink}
        />
        <div className="file-explorer-actions">
          <Button hasIcon onClick={refresh} title="Refresh">
            <Icon name="restart" />
          </Button>
          <NewFolderButton
            target={target}
            currentPath={currentPath}
            existing={names}
            owner={owner}
            onCreated={refresh}
            disabledReason={writeDisabledReason}
          />
          <FileUploadButton
            target={target}
            currentPath={currentPath}
            existing={names}
            owner={owner}
            onUploaded={refresh}
            disabledReason={writeDisabledReason}
          />
        </div>
      </div>
      {error ? (
        <>
          <Notification
            severity="negative"
            title="Error connecting to file system"
          >
            {error.message}
          </Notification>
          <Button appearance="positive" onClick={refresh}>
            Retry connection
          </Button>
        </>
      ) : isLoading ? (
        <Spinner className="u-loader" text="Loading file system..." />
      ) : (
        <ScrollableTable
          dependencies={[headers, sortedRows]}
          tableId="file-explorer-table"
          belowIds={["status-bar"]}
        >
          <MainTable
            id="file-explorer-table"
            headers={headers}
            rows={sortedRows}
            onUpdateSort={updateSort}
            emptyStateMsg="This directory is empty"
            className="u-selectable-table-rows"
            sortable
          />
        </ScrollableTable>
      )}
    </div>
  );
};

export default FileExplorer;
