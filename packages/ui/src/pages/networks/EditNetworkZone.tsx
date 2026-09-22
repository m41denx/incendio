import { useEffect, useState, type FC } from "react";
import {
  ActionButton,
  Button,
  ConfirmationButton,
  Icon,
  MainTable,
  Row,
  Spinner,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useFormik } from "formik";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { queryKeys } from "util/queryKeys";
import { ROOT_PATH } from "util/rootPath";
import NotificationRow from "components/NotificationRow";
import BaseLayout from "components/BaseLayout";
import FormFooterLayout from "components/forms/FormFooterLayout";
import NetworkZoneForm, {
  toNetworkZone,
  toNetworkZoneFormValues,
  type NetworkZoneFormValues,
} from "pages/networks/forms/NetworkZoneForm";
import NetworkZoneRecordModal from "pages/networks/forms/NetworkZoneRecordModal";
import { useNetworkZone, useNetworkZoneRecords } from "context/useNetworkZones";
import {
  createNetworkZoneRecord,
  deleteNetworkZone,
  deleteNetworkZoneRecord,
  updateNetworkZone,
  updateNetworkZoneRecord,
} from "api/network-zones";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import type { LxdNetworkZoneRecord } from "types/network";

const EditNetworkZone: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { name, project } = useParams<{ name: string; project: string }>();
  const { hasNetworkZoneRecords } = useSupportedFeatures();
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<
    LxdNetworkZoneRecord | undefined
  >(undefined);
  const [savingRecord, setSavingRecord] = useState(false);

  if (!name) {
    return <>Missing name</>;
  }

  if (!project) {
    return <>Missing project</>;
  }

  const { data: zone, error, isLoading } = useNetworkZone(name, project);
  const { data: records = [] } = useNetworkZoneRecords(name, project);

  useEffect(() => {
    if (error) {
      notify.failure("Loading network zone failed", error);
    }
  }, [error]);

  const invalidateZone = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.projects, project, queryKeys.networkZones],
    });
  };

  const invalidateRecords = () => {
    queryClient.invalidateQueries({
      queryKey: [
        queryKeys.projects,
        project,
        queryKeys.networkZones,
        name,
        queryKeys.networkZoneRecords,
      ],
    });
  };

  const formik = useFormik<NetworkZoneFormValues>({
    initialValues: zone
      ? toNetworkZoneFormValues(zone)
      : { name, config: {}, isCreating: false, readOnly: true },
    enableReinitialize: true,
    onSubmit: (values) => {
      const payload = toNetworkZone(values);
      updateNetworkZone(payload, project)
        .then(() => {
          invalidateZone();
          toastNotify.success(`Network zone ${payload.name} updated.`);
          navigate(
            `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zones`,
          );
        })
        .catch((e) => {
          formik.setSubmitting(false);
          notify.failure(`Update of network zone ${payload.name} failed`, e);
        });
    },
  });

  const handleDeleteZone = () => {
    deleteNetworkZone(name, project)
      .then(() => {
        invalidateZone();
        toastNotify.success(`Network zone ${name} deleted.`);
        navigate(
          `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zones`,
        );
      })
      .catch((e) => {
        notify.failure(`Deletion of network zone ${name} failed`, e);
      });
  };

  const handleRecordSubmit = (record: LxdNetworkZoneRecord) => {
    setSavingRecord(true);
    const action = editingRecord
      ? updateNetworkZoneRecord(name, record, project)
      : createNetworkZoneRecord(name, record, project);
    action
      .then(() => {
        toastNotify.success(
          `Record ${record.name} ${editingRecord ? "updated" : "created"}.`,
        );
        setRecordModalOpen(false);
        setEditingRecord(undefined);
      })
      .catch((e) => {
        notify.failure(`Saving record ${record.name} failed`, e);
      })
      .finally(() => {
        setSavingRecord(false);
        invalidateRecords();
      });
  };

  const handleDeleteRecord = (record: string) => {
    deleteNetworkZoneRecord(name, record, project)
      .then(() => {
        toastNotify.success(`Record ${record} deleted.`);
      })
      .catch((e) => {
        toastNotify.failure(`Deletion of record ${record} failed`, e);
      })
      .finally(() => {
        invalidateRecords();
      });
  };

  if (isLoading) {
    return <Spinner className="u-loader" text="Loading..." isMainComponent />;
  }

  const usedByCount = (zone?.used_by ?? []).length;

  const recordHeaders = [
    { content: "Name", sortKey: "name" },
    { content: "Entries" },
    { "aria-label": "Actions", className: "u-align--right actions" },
  ];

  const recordRows = records.map((record) => ({
    key: record.name,
    columns: [
      { content: record.name, role: "cell", "aria-label": "Name" },
      {
        content: (record.entries ?? []).map((entry, index) => (
          <div key={index} className="u-truncate">
            <code>{entry.type}</code> {entry.value}
            {entry.ttl ? ` (ttl ${entry.ttl})` : ""}
          </div>
        )),
        role: "cell",
        "aria-label": "Entries",
      },
      {
        content: (
          <>
            <Button
              appearance="base"
              hasIcon
              dense
              title="Edit record"
              className="u-no-margin--bottom"
              onClick={() => {
                setEditingRecord(record);
                setRecordModalOpen(true);
              }}
            >
              <Icon name="edit" />
            </Button>
            <ConfirmationButton
              appearance="base"
              className="has-icon"
              title="Delete record"
              confirmationModalProps={{
                title: "Confirm deletion",
                children: (
                  <p>
                    This will permanently delete the record{" "}
                    <strong>{record.name}</strong>.
                  </p>
                ),
                confirmButtonLabel: "Delete",
                onConfirm: () => {
                  handleDeleteRecord(record.name);
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
  }));

  return (
    <BaseLayout title={`Edit ${name}`} contentClassName="edit-network-zone">
      <Row>
        <NotificationRow />
        <NetworkZoneForm formik={formik} />
      </Row>

      {hasNetworkZoneRecords && (
        <Row>
          <div className="u-flex u-flex--between u-sv2">
            <h2 className="p-heading--4 u-no-margin--bottom">Records</h2>
            <Button
              hasIcon
              className="u-no-margin--bottom"
              onClick={() => {
                setEditingRecord(undefined);
                setRecordModalOpen(true);
              }}
            >
              <Icon name="plus" />
              <span>Add record</span>
            </Button>
          </div>
          {records.length > 0 ? (
            <MainTable headers={recordHeaders} rows={recordRows} responsive />
          ) : (
            <p className="u-text--muted">No records in this zone yet.</p>
          )}
        </Row>
      )}

      <FormFooterLayout>
        <ConfirmationButton
          appearance="base"
          className="has-icon"
          disabled={usedByCount > 0}
          title={
            usedByCount > 0
              ? "This zone is in use and cannot be deleted"
              : "Delete network zone"
          }
          confirmationModalProps={{
            title: "Confirm deletion",
            children: (
              <p>
                This will permanently delete the network zone{" "}
                <strong>{name}</strong>.
              </p>
            ),
            confirmButtonLabel: "Delete",
            onConfirm: handleDeleteZone,
          }}
        >
          <Icon name="delete" />
          <span>Delete</span>
        </ConfirmationButton>
        <Button
          appearance="base"
          onClick={async () =>
            navigate(
              `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zones`,
            )
          }
        >
          Cancel
        </Button>
        <ActionButton
          appearance="positive"
          loading={formik.isSubmitting}
          disabled={formik.isSubmitting || !formik.dirty}
          onClick={() => void formik.submitForm()}
        >
          Save changes
        </ActionButton>
      </FormFooterLayout>

      {recordModalOpen && (
        <NetworkZoneRecordModal
          record={editingRecord}
          isSaving={savingRecord}
          onClose={() => {
            setRecordModalOpen(false);
            setEditingRecord(undefined);
          }}
          onSubmit={handleRecordSubmit}
        />
      )}
    </BaseLayout>
  );
};

export default EditNetworkZone;
