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
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import NotificationRow from "components/NotificationRow";
import HelpLink from "components/HelpLink";
import PageHeader from "components/PageHeader";
import DocLink from "components/DocLink";
import { ROOT_PATH } from "util/rootPath";
import { queryKeys } from "util/queryKeys";
import { useNetworkZones } from "context/useNetworkZones";
import { deleteNetworkZone } from "api/network-zones";
import type { LxdNetworkZone } from "types/network";
import useSortTableData from "util/useSortTableData";

const NetworkZoneList: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { project } = useParams<{ project: string }>();

  if (!project) {
    return <>Missing project</>;
  }

  const { data: zones = [], error, isLoading } = useNetworkZones(project);

  useEffect(() => {
    if (error) {
      notify.failure("Loading network zones failed", error);
    }
  }, [error]);

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.projects, project, queryKeys.networkZones],
    });
  };

  const handleDelete = (zone: LxdNetworkZone) => {
    deleteNetworkZone(zone.name, project)
      .then(() => {
        toastNotify.success(`Network zone ${zone.name} deleted.`);
      })
      .catch((e) => {
        toastNotify.failure(`Deletion of network zone ${zone.name} failed`, e);
      })
      .finally(() => {
        invalidateCache();
      });
  };

  const headers = [
    { content: "Name", sortKey: "name" },
    { content: "Description", sortKey: "description" },
    { content: "Used by", sortKey: "usedBy", className: "u-align--right" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = zones.map((zone) => {
    const usedByCount = (zone.used_by ?? []).length;
    return {
      key: zone.name,
      columns: [
        {
          content: (
            <Link
              to={`${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zone/${encodeURIComponent(zone.name)}`}
            >
              {zone.name}
            </Link>
          ),
          role: "rowheader",
          "aria-label": "Name",
        },
        {
          content: zone.description,
          role: "cell",
          "aria-label": "Description",
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
              title="Delete network zone"
              disabled={usedByCount > 0}
              confirmationModalProps={{
                title: "Confirm deletion",
                children: (
                  <p>
                    This will permanently delete the network zone{" "}
                    <strong>{zone.name}</strong>.
                  </p>
                ),
                confirmButtonLabel: "Delete",
                onConfirm: () => {
                  handleDelete(zone);
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
        name: zone.name.toLowerCase(),
        description: zone.description?.toLowerCase(),
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
        navigate(
          `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zones/create`,
        )
      }
    >
      <Icon name="plus" light />
      <span>Create zone</span>
    </Button>
  );

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
                docPath="/howto/network_zones/"
                title="Learn more about network zones"
              >
                Network zones
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
          <PageHeader.BaseActions>
            {zones.length > 0 && createButton}
          </PageHeader.BaseActions>
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        {zones.length > 0 && (
          <MainTable
            headers={headers}
            rows={sortedRows}
            onUpdateSort={updateSort}
            responsive
            sortable
            emptyStateMsg="No data to display"
          />
        )}
        {!isLoading && zones.length === 0 && (
          <EmptyState
            className="empty-state"
            image={<Icon className="empty-state-icon" name="exposed" />}
            title="No network zones found"
          >
            <p>
              Network zones manage DNS for your networks, serving records for
              instances and custom entries.
            </p>
            <p>
              <DocLink docPath="/howto/network_zones/" hasExternalIcon>
                Learn more about network zones
              </DocLink>
            </p>
            {createButton}
          </EmptyState>
        )}
      </Row>
    </CustomLayout>
  );
};

export default NetworkZoneList;
