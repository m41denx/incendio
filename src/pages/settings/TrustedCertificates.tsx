import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  ConfirmationButton,
  CustomLayout,
  EmptyState,
  Icon,
  Input,
  MainTable,
  Modal,
  Row,
  ScrollableTable,
  Spinner,
  usePortal,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addCertificate,
  deleteCertificate,
  fetchCertificates,
} from "api/certificates";
import { queryKeys } from "util/queryKeys";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import useSortTableData from "util/useSortTableData";
import type { LxdCertificate } from "types/certificate";

const TrustedCertificates: FC = () => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  const [token, setToken] = useState("");
  const [isAdding, setAdding] = useState(false);
  const [deletingFingerprints, setDeletingFingerprints] = useState<string[]>(
    [],
  );

  const {
    data: certificates = [],
    error,
    isLoading,
  } = useQuery({
    queryKey: [queryKeys.certificates],
    queryFn: fetchCertificates,
    // the api returns a 403 for non-admin users, surface the error right away
    retry: false,
  });

  if (error) {
    notify.failure("Loading trusted certificates failed", error);
  }

  const invalidateCertificates = async () =>
    queryClient.invalidateQueries({ queryKey: [queryKeys.certificates] });

  const handleDelete = (certificate: LxdCertificate) => {
    setDeletingFingerprints((prev) => [...prev, certificate.fingerprint]);
    deleteCertificate(certificate.fingerprint)
      .then(() => {
        toastNotify.success(
          `Certificate ${certificate.name || certificate.fingerprint.slice(0, 12)} removed.`,
        );
      })
      .catch((e) => {
        toastNotify.failure("Certificate removal failed", e);
      })
      .finally(() => {
        setDeletingFingerprints((prev) =>
          prev.filter((f) => f !== certificate.fingerprint),
        );
        void invalidateCertificates();
      });
  };

  const handleAdd = () => {
    setAdding(true);
    addCertificate(token.trim())
      .then(() => {
        toastNotify.success("Certificate added to the trust store.");
        setToken("");
        closePortal();
      })
      .catch((e) => {
        notify.failure("Adding certificate failed", e);
      })
      .finally(() => {
        setAdding(false);
        void invalidateCertificates();
      });
  };

  const headers = [
    { content: "Name", sortKey: "name" },
    { content: "Fingerprint", sortKey: "fingerprint" },
    { content: "Type", sortKey: "type" },
    { content: "Restricted", sortKey: "restricted" },
    { content: "Projects", sortKey: "projects" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const rows = certificates.map((certificate) => {
    const projects =
      !certificate.restricted || certificate.projects.length === 0
        ? "all"
        : certificate.projects.join(", ");

    return {
      key: certificate.fingerprint,
      columns: [
        {
          content: certificate.name || "-",
          role: "rowheader",
          "aria-label": "Name",
        },
        {
          content: (
            <code title={certificate.fingerprint}>
              {certificate.fingerprint.slice(0, 12)}
            </code>
          ),
          role: "cell",
          "aria-label": "Fingerprint",
        },
        {
          content: certificate.type,
          role: "cell",
          "aria-label": "Type",
        },
        {
          content: certificate.restricted ? "yes" : "no",
          role: "cell",
          "aria-label": "Restricted",
        },
        {
          content: projects,
          role: "cell",
          "aria-label": "Projects",
        },
        {
          content: (
            <ConfirmationButton
              appearance="base"
              className="has-icon"
              loading={deletingFingerprints.includes(certificate.fingerprint)}
              disabled={deletingFingerprints.includes(certificate.fingerprint)}
              title="Remove certificate"
              confirmationModalProps={{
                title: "Confirm removal",
                children: (
                  <p>
                    This will permanently remove the trusted certificate{" "}
                    <strong>
                      {certificate.name || certificate.fingerprint.slice(0, 12)}
                    </strong>{" "}
                    from the server. Any client using it will lose access.
                  </p>
                ),
                confirmButtonLabel: "Remove",
                onConfirm: () => {
                  handleDelete(certificate);
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
        name: certificate.name.toLowerCase(),
        fingerprint: certificate.fingerprint,
        type: certificate.type,
        restricted: certificate.restricted,
        projects,
      },
    };
  });

  const { rows: sortedRows, updateSort } = useSortTableData({ rows });
  const isEmptyState = certificates.length === 0 && !isLoading && !error;

  return (
    <CustomLayout
      contentClassName="u-no-padding--bottom"
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/explanation/security/"
                title="Learn more about trusted certificates"
              >
                Trusted certificates
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
          <PageHeader.BaseActions>
            <Button appearance="positive" hasIcon onClick={openPortal}>
              <Icon name="plus" light />
              <span>Add certificate</span>
            </Button>
          </PageHeader.BaseActions>
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        {isLoading ? (
          <Spinner
            className="u-loader"
            text="Loading trusted certificates..."
          />
        ) : isEmptyState ? (
          <EmptyState
            className="empty-state"
            image={<Icon name="security" className="empty-state-icon" />}
            title="No trusted certificates"
          >
            <p>
              There are no client certificates in the server trust store, or you
              do not have permission to view them.
            </p>
            <Button appearance="positive" hasIcon onClick={openPortal}>
              <Icon name="plus" light />
              <span>Add certificate</span>
            </Button>
          </EmptyState>
        ) : (
          <ScrollableTable
            dependencies={[certificates, notify.notification]}
            tableId="trusted-certificates-table"
            belowIds={["status-bar"]}
          >
            <MainTable
              id="trusted-certificates-table"
              headers={headers}
              rows={sortedRows}
              sortable
              onUpdateSort={updateSort}
              className="trusted-certificates-table"
            />
          </ScrollableTable>
        )}
      </Row>
      {isOpen && (
        <Portal>
          <Modal
            close={closePortal}
            title="Add trusted certificate"
            buttonRow={
              <>
                <Button
                  appearance="base"
                  className="u-no-margin--bottom"
                  onClick={closePortal}
                  type="button"
                >
                  Cancel
                </Button>
                <ActionButton
                  appearance="positive"
                  className="u-no-margin--bottom"
                  loading={isAdding}
                  disabled={token.trim().length === 0 || isAdding}
                  onClick={handleAdd}
                  type="button"
                >
                  Add certificate
                </ActionButton>
              </>
            }
          >
            <Input
              type="text"
              label="Trust token"
              help="Paste a trust token issued by the Incus server to add its certificate to the trust store."
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
              }}
              autoComplete="off"
            />
          </Modal>
        </Portal>
      )}
    </CustomLayout>
  );
};

export default TrustedCertificates;
