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
import { useNetworkAddressSets } from "context/useNetworkAddressSets";
import { deleteNetworkAddressSet } from "api/network-address-sets";
import type { LxdNetworkAddressSet } from "types/network";
import useSortTableData from "util/useSortTableData";

const NetworkAddressSetList: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { project } = useParams<{ project: string }>();

  if (!project) {
    return <>Missing project</>;
  }

  const {
    data: addressSets = [],
    error,
    isLoading,
  } = useNetworkAddressSets(project);

  useEffect(() => {
    if (error) {
      notify.failure("Loading address sets failed", error);
    }
  }, [error]);

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.projects, project, queryKeys.networkAddressSets],
    });
  };

  const handleDelete = (addressSet: LxdNetworkAddressSet) => {
    deleteNetworkAddressSet(addressSet.name, project)
      .then(() => {
        toastNotify.success(`Address set ${addressSet.name} deleted.`);
      })
      .catch((e) => {
        toastNotify.failure(
          `Deletion of address set ${addressSet.name} failed`,
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
    { content: "Addresses", sortKey: "addresses", className: "u-align--right" },
    { content: "Used by", sortKey: "usedBy", className: "u-align--right" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = addressSets.map((addressSet) => {
    const addressCount = (addressSet.addresses ?? []).length;
    const usedByCount = (addressSet.used_by ?? []).length;
    return {
      key: addressSet.name,
      columns: [
        {
          content: (
            <Link
              to={`${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-set/${encodeURIComponent(addressSet.name)}`}
            >
              {addressSet.name}
            </Link>
          ),
          role: "rowheader",
          "aria-label": "Name",
        },
        {
          content: addressSet.description,
          role: "cell",
          "aria-label": "Description",
        },
        {
          content: addressCount,
          role: "cell",
          "aria-label": "Addresses",
          className: "u-align--right",
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
              title="Delete address set"
              disabled={usedByCount > 0}
              confirmationModalProps={{
                title: "Confirm deletion",
                children: (
                  <p>
                    This will permanently delete the address set{" "}
                    <strong>{addressSet.name}</strong>.
                  </p>
                ),
                confirmButtonLabel: "Delete",
                onConfirm: () => {
                  handleDelete(addressSet);
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
        name: addressSet.name.toLowerCase(),
        description: addressSet.description?.toLowerCase(),
        addresses: addressCount,
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
          `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-sets/create`,
        )
      }
    >
      <Icon name="plus" light />
      <span>Create address set</span>
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
                docPath="/howto/network_address_sets/"
                title="Learn more about network address sets"
              >
                Network address sets
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
          <PageHeader.BaseActions>
            {addressSets.length > 0 && createButton}
          </PageHeader.BaseActions>
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        {addressSets.length > 0 && (
          <MainTable
            headers={headers}
            rows={sortedRows}
            onUpdateSort={updateSort}
            responsive
            sortable
            emptyStateMsg="No data to display"
          />
        )}
        {!isLoading && addressSets.length === 0 && (
          <EmptyState
            className="empty-state"
            image={<Icon className="empty-state-icon" name="exposed" />}
            title="No address sets found"
          >
            <p>
              Address sets are named groups of IP addresses, subnets and ranges
              that can be referenced from network ACL rules.
            </p>
            <p>
              <DocLink docPath="/howto/network_address_sets/" hasExternalIcon>
                Learn more about address sets
              </DocLink>
            </p>
            {createButton}
          </EmptyState>
        )}
      </Row>
    </CustomLayout>
  );
};

export default NetworkAddressSetList;
