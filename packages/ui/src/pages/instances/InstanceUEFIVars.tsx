import { type FC } from "react";
import {
  ConfirmationButton,
  EmptyState,
  Icon,
  MainTable,
  Spinner,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import { useInstanceNVRAM } from "context/useInstances";
import { deleteInstanceNVRAMVariable } from "api/instances";
import type { LxdInstance, LxdInstanceNVRAMVariable } from "types/instance";
import useSortTableData from "util/useSortTableData";

interface Props {
  instance: LxdInstance;
}

const renderValue = (variable: LxdInstanceNVRAMVariable): string => {
  const data = variable.data;
  if (data === null || data === undefined || data === "") {
    return "-";
  }
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return "(unserialisable value)";
  }
};

const renderSize = (variable: LxdInstanceNVRAMVariable): string => {
  const size = variable.binary?.length ?? 0;
  return `${size} ${size === 1 ? "byte" : "bytes"}`;
};

const InstanceUEFIVars: FC<Props> = ({ instance }) => {
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();

  const {
    data: nvram = {},
    error,
    isLoading,
  } = useInstanceNVRAM(instance.name, instance.project);

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [
        queryKeys.instances,
        instance.name,
        instance.project,
        queryKeys.nvram,
      ],
    });
  };

  const handleDelete = (guid: string, variable: string) => {
    deleteInstanceNVRAMVariable(instance.name, instance.project, guid, variable)
      .then(() => {
        toastNotify.success(`UEFI variable ${variable} deleted.`);
      })
      .catch((e) => {
        toastNotify.failure(`Deletion of UEFI variable ${variable} failed`, e);
      })
      .finally(() => {
        invalidateCache();
      });
  };

  const headers = [
    { content: "GUID", sortKey: "guid" },
    { content: "Variable", sortKey: "variable" },
    { content: "Attributes", sortKey: "attributes" },
    { content: "Value", sortKey: "value" },
    { content: "Size", sortKey: "size", className: "u-align--right" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const guids = Object.keys(nvram).sort((a, b) => a.localeCompare(b));

  const rows = guids.flatMap((guid) => {
    const variables = nvram[guid] ?? {};
    const names = Object.keys(variables).sort((a, b) => a.localeCompare(b));
    return names.map((name, index) => {
      const variable = variables[name];
      return {
        key: `${guid}/${name}`,
        columns: [
          {
            content: index === 0 ? <code>{guid}</code> : "",
            role: "cell",
            "aria-label": "GUID",
          },
          {
            content: name,
            role: "rowheader",
            "aria-label": "Variable",
          },
          {
            content: (variable.attributes ?? []).join(", ") || "-",
            role: "cell",
            "aria-label": "Attributes",
          },
          {
            content: (
              <span className="u-truncate" title={renderValue(variable)}>
                {renderValue(variable)}
              </span>
            ),
            role: "cell",
            "aria-label": "Value",
          },
          {
            content: renderSize(variable),
            role: "cell",
            "aria-label": "Size",
            className: "u-align--right",
          },
          {
            content: (
              <ConfirmationButton
                appearance="base"
                className="has-icon"
                title="Delete UEFI variable"
                confirmationModalProps={{
                  title: "Confirm deletion",
                  children: (
                    <p>
                      This will permanently delete the UEFI variable{" "}
                      <strong>{name}</strong>. This can prevent the instance
                      from booting.
                    </p>
                  ),
                  confirmButtonLabel: "Delete",
                  onConfirm: () => {
                    handleDelete(guid, name);
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
          guid,
          variable: name.toLowerCase(),
          attributes: (variable.attributes ?? []).join(", ").toLowerCase(),
          value: renderValue(variable).toLowerCase(),
          size: variable.binary?.length ?? 0,
        },
      };
    });
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  if (isLoading) {
    return <Spinner className="u-loader" text="Loading UEFI variables..." />;
  }

  if (error) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="security" className="empty-state-icon" />}
        title="No UEFI variables"
      >
        <p>
          UEFI variables are only available once the virtual machine&rsquo;s
          NVRAM has been generated (start the instance at least once).
        </p>
      </EmptyState>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="security" className="empty-state-icon" />}
        title="No UEFI variables"
      >
        <p>This virtual machine has no UEFI variables to display.</p>
      </EmptyState>
    );
  }

  return (
    <MainTable
      headers={headers}
      rows={sortedRows}
      paginate={30}
      responsive
      sortable
      onUpdateSort={updateSort}
      className="u-table-layout--auto"
    />
  );
};

export default InstanceUEFIVars;
