import { useEffect, type FC } from "react";
import {
  Button,
  ConfirmationButton,
  CustomLayout,
  EmptyState,
  Icon,
  MainTable,
  Row,
  Spinner,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import NotificationRow from "components/NotificationRow";
import HelpLink from "components/HelpLink";
import PageHeader from "components/PageHeader";
import DocLink from "components/DocLink";
import { ROOT_PATH } from "util/rootPath";
import { queryKeys } from "util/queryKeys";
import { useNetworkIntegrations } from "context/useNetworkIntegrations";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { deleteNetworkIntegration } from "api/network-integrations";
import type { LxdNetworkIntegration } from "types/network";
import useSortTableData from "util/useSortTableData";

const NetworkIntegrationList: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { hasNetworkIntegrations } = useSupportedFeatures();

  const {
    data: integrations = [],
    error,
    isLoading,
  } = useNetworkIntegrations();

  useEffect(() => {
    if (error) {
      notify.failure("Loading network integrations failed", error);
    }
  }, [error]);

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.networkIntegrations],
    });
  };

  const handleDelete = (integration: LxdNetworkIntegration) => {
    deleteNetworkIntegration(integration.name)
      .then(() => {
        toastNotify.success(`Network integration ${integration.name} deleted.`);
      })
      .catch((e) => {
        toastNotify.failure(
          `Deletion of network integration ${integration.name} failed`,
          e,
        );
      })
      .finally(() => {
        invalidateCache();
      });
  };

  const headers = [
    { content: "Name", sortKey: "name" },
    { content: "Description", sortKey: "description" },
    { content: "Type", sortKey: "type" },
    { content: "Used by", sortKey: "usedBy", className: "u-align--right" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = integrations.map((integration) => {
    const usedByCount = (integration.used_by ?? []).length;
    return {
      key: integration.name,
      columns: [
        {
          content: (
            <Link
              to={`${ROOT_PATH}/ui/network-integration/${encodeURIComponent(integration.name)}`}
            >
              {integration.name}
            </Link>
          ),
          role: "rowheader",
          "aria-label": "Name",
        },
        {
          content: integration.description,
          role: "cell",
          "aria-label": "Description",
        },
        {
          content: integration.type.toUpperCase(),
          role: "cell",
          "aria-label": "Type",
        },
        {
          content: usedByCount,
          role: "cell",
          "aria-label": "Used by",
          className: "u-align--right",
        },
        {
          content: (
            <ConfirmationButton
              appearance="base"
              className="has-icon"
              title="Delete network integration"
              disabled={usedByCount > 0}
              confirmationModalProps={{
                title: "Confirm deletion",
                children: (
                  <p>
                    This will permanently delete the network integration{" "}
                    <strong>{integration.name}</strong>.
                  </p>
                ),
                confirmButtonLabel: "Delete",
                onConfirm: () => {
                  handleDelete(integration);
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
        name: integration.name.toLowerCase(),
        description: integration.description?.toLowerCase(),
        type: integration.type,
        usedBy: usedByCount,
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });

  const createButton = (
    <Button
      appearance="positive"
      className="u-no-margin--bottom"
      hasIcon
      onClick={async () =>
        navigate(`${ROOT_PATH}/ui/network-integrations/create`)
      }
    >
      <Icon name="plus" light />
      <span>Create integration</span>
    </Button>
  );

  if (!hasNetworkIntegrations) {
    return (
      <CustomLayout
        header={
          <PageHeader>
            <PageHeader.Left>
              <PageHeader.Title>Network integrations</PageHeader.Title>
            </PageHeader.Left>
          </PageHeader>
        }
      >
        <Row>
          <EmptyState
            className="empty-state"
            image={<Icon className="empty-state-icon" name="connected" />}
            title="Network integrations are not supported"
          >
            <p>
              This server does not support OVN interconnect network
              integrations.
            </p>
          </EmptyState>
        </Row>
      </CustomLayout>
    );
  }

  if (isLoading) {
    return <Spinner className="u-loader" text="Loading..." isMainComponent />;
  }

  return (
    <CustomLayout
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/howto/network_integrations/"
                title="Learn more about OVN interconnect integrations"
              >
                Network integrations
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
          <PageHeader.BaseActions>
            {integrations.length > 0 && createButton}
          </PageHeader.BaseActions>
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        {integrations.length > 0 && (
          <MainTable
            headers={headers}
            rows={sortedRows}
            onUpdateSort={updateSort}
            responsive
            sortable
            emptyStateMsg="No data to display"
          />
        )}
        {!isLoading && integrations.length === 0 && (
          <EmptyState
            className="empty-state"
            image={<Icon className="empty-state-icon" name="connected" />}
            title="No network integrations found"
          >
            <p>
              OVN interconnect integrations let networks peer across separate
              Incus deployments.
            </p>
            <p>
              <DocLink docPath="/howto/network_integrations/" hasExternalIcon>
                Learn more about OVN networking
              </DocLink>
            </p>
            {createButton}
          </EmptyState>
        )}
      </Row>
    </CustomLayout>
  );
};

export default NetworkIntegrationList;
