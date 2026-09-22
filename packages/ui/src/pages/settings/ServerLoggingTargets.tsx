import { useState, type FC } from "react";
import {
  Button,
  ConfirmationButton,
  CustomLayout,
  EmptyState,
  Icon,
  MainTable,
  Notification,
  Row,
  Spinner,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import { useSettings } from "context/useSettings";
import { updateSettings } from "api/server";
import { queryKeys } from "util/queryKeys";
import { useServerEntitlements } from "util/entitlements/server";
import useSortTableData from "util/useSortTableData";
import {
  parseLoggingTargets,
  loggingTargetToConfig,
  type LoggingTarget,
} from "util/serverLogging";
import ServerLoggingTargetForm from "pages/settings/ServerLoggingTargetForm";

const ServerLoggingTargets: FC = () => {
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettings();
  const { canEditServerConfiguration } = useServerEntitlements();

  const [panelTarget, setPanelTarget] = useState<LoggingTarget | undefined>();
  const [isCreating, setIsCreating] = useState(false);

  const targets = parseLoggingTargets(settings?.config);

  const invalidateCache = () => {
    queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
  };

  const handleDelete = (target: LoggingTarget) => {
    updateSettings(loggingTargetToConfig(target, true))
      .then(() => {
        toastNotify.success(`Logging target ${target.name} deleted.`);
      })
      .catch((e) => {
        toastNotify.failure(
          `Deletion of logging target ${target.name} failed`,
          e,
        );
      })
      .finally(() => {
        invalidateCache();
      });
  };

  const headers = [
    { content: "Name", sortKey: "name" },
    { content: "Type", sortKey: "type" },
    { content: "Address", sortKey: "address" },
    { content: "Level", sortKey: "level" },
    { content: "Event types", sortKey: "types" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = targets.map((target) => {
    return {
      key: target.name,
      columns: [
        { content: target.name, role: "rowheader", "aria-label": "Name" },
        { content: target.type || "-", role: "cell", "aria-label": "Type" },
        {
          content: target.address || "-",
          role: "cell",
          "aria-label": "Address",
        },
        { content: target.level || "-", role: "cell", "aria-label": "Level" },
        {
          content: target.types || "-",
          role: "cell",
          "aria-label": "Event types",
        },
        {
          content: (
            <>
              <Button
                appearance="base"
                className="has-icon u-no-margin--bottom"
                title="Edit logging target"
                onClick={() => {
                  setIsCreating(false);
                  setPanelTarget(target);
                }}
              >
                <Icon name="edit" />
              </Button>
              <ConfirmationButton
                appearance="base"
                className="has-icon"
                title="Delete logging target"
                confirmationModalProps={{
                  title: "Confirm deletion",
                  children: (
                    <p>
                      This will permanently delete the logging target{" "}
                      <strong>{target.name}</strong>.
                    </p>
                  ),
                  confirmButtonLabel: "Delete",
                  onConfirm: () => {
                    handleDelete(target);
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
      sortData: {
        name: target.name.toLowerCase(),
        type: target.type.toLowerCase(),
        address: target.address.toLowerCase(),
        level: target.level.toLowerCase(),
        types: target.types.toLowerCase(),
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  return (
    <CustomLayout
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/reference/server_settings/"
                title="Learn more about server logging"
              >
                Logging targets
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
          {canEditServerConfiguration() && targets.length > 0 && (
            <PageHeader.BaseActions>
              <Button
                appearance="positive"
                hasIcon
                onClick={() => {
                  setIsCreating(true);
                  setPanelTarget(undefined);
                }}
              >
                <Icon name="plus" light />
                <span>Create logging target</span>
              </Button>
            </PageHeader.BaseActions>
          )}
        </PageHeader>
      }
      contentClassName="settings"
    >
      <NotificationRow />
      <Row>
        {!canEditServerConfiguration() ? (
          <Notification
            severity="caution"
            title="Restricted permissions"
            titleElement="h2"
          >
            You do not have permission to view or edit server settings
          </Notification>
        ) : isLoading ? (
          <Spinner className="u-loader" text="Loading..." />
        ) : targets.length === 0 ? (
          <EmptyState
            className="empty-state"
            image={<Icon name="pods" className="empty-state-icon" />}
            title="No logging targets"
          >
            <p>Forward Incus events to Loki, syslog or a webhook endpoint.</p>
            <Button
              appearance="positive"
              onClick={() => {
                setIsCreating(true);
                setPanelTarget(undefined);
              }}
            >
              Create logging target
            </Button>
          </EmptyState>
        ) : (
          <MainTable
            headers={headers}
            rows={sortedRows}
            sortable
            responsive
            onUpdateSort={updateSort}
            className="u-table-layout--auto"
          />
        )}
      </Row>
      {(isCreating || panelTarget) && (
        <ServerLoggingTargetForm
          target={panelTarget}
          existingNames={targets.map((t) => t.name)}
          close={() => {
            setIsCreating(false);
            setPanelTarget(undefined);
          }}
        />
      )}
    </CustomLayout>
  );
};

export default ServerLoggingTargets;
