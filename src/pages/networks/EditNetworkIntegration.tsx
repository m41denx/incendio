import { useEffect, type FC } from "react";
import {
  ActionButton,
  Button,
  ConfirmationButton,
  Icon,
  Row,
  Spinner,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { queryKeys } from "util/queryKeys";
import { ROOT_PATH } from "util/rootPath";
import NotificationRow from "components/NotificationRow";
import BaseLayout from "components/BaseLayout";
import FormFooterLayout from "components/forms/FormFooterLayout";
import NetworkIntegrationForm, {
  toNetworkIntegration,
  toNetworkIntegrationFormValues,
  type NetworkIntegrationFormValues,
} from "pages/networks/forms/NetworkIntegrationForm";
import { useNetworkIntegration } from "context/useNetworkIntegrations";
import {
  deleteNetworkIntegration,
  updateNetworkIntegration,
} from "api/network-integrations";

const EditNetworkIntegration: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { name } = useParams<{ name: string }>();

  if (!name) {
    return <>Missing name</>;
  }

  const { data: integration, error, isLoading } = useNetworkIntegration(name);

  useEffect(() => {
    if (error) {
      notify.failure("Loading network integration failed", error);
    }
  }, [error]);

  const IntegrationSchema = Yup.object().shape({
    ovnNorthboundConnection: Yup.string().required(
      "An OVN northbound connection is required",
    ),
    ovnSouthboundConnection: Yup.string().required(
      "An OVN southbound connection is required",
    ),
  });

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.networkIntegrations],
    });
  };

  const formik = useFormik<NetworkIntegrationFormValues>({
    initialValues: integration
      ? toNetworkIntegrationFormValues(integration)
      : {
          name: name,
          integrationType: "ovn",
          isCreating: false,
          readOnly: true,
        },
    validationSchema: IntegrationSchema,
    enableReinitialize: true,
    onSubmit: (values) => {
      const payload = toNetworkIntegration(values);
      updateNetworkIntegration(payload)
        .then(() => {
          invalidateCache();
          toastNotify.success(`Network integration ${payload.name} updated.`);
          navigate(`${ROOT_PATH}/ui/network-integrations`);
        })
        .catch((e) => {
          formik.setSubmitting(false);
          notify.failure(
            `Update of network integration ${payload.name} failed`,
            e,
          );
        });
    },
  });

  const handleDelete = () => {
    deleteNetworkIntegration(name)
      .then(() => {
        invalidateCache();
        toastNotify.success(`Network integration ${name} deleted.`);
        navigate(`${ROOT_PATH}/ui/network-integrations`);
      })
      .catch((e) => {
        notify.failure(`Deletion of network integration ${name} failed`, e);
      });
  };

  if (isLoading) {
    return <Spinner className="u-loader" text="Loading..." isMainComponent />;
  }

  const usedByCount = (integration?.used_by ?? []).length;

  return (
    <BaseLayout
      title={`Edit ${name}`}
      contentClassName="edit-network-integration"
    >
      <Row>
        <NotificationRow />
        <NetworkIntegrationForm formik={formik} />
      </Row>
      <FormFooterLayout>
        <ConfirmationButton
          appearance="base"
          className="has-icon"
          disabled={usedByCount > 0}
          title={
            usedByCount > 0
              ? "This integration is in use and cannot be deleted"
              : "Delete network integration"
          }
          confirmationModalProps={{
            title: "Confirm deletion",
            children: (
              <p>
                This will permanently delete the network integration{" "}
                <strong>{name}</strong>.
              </p>
            ),
            confirmButtonLabel: "Delete",
            onConfirm: handleDelete,
          }}
        >
          <Icon name="delete" />
          <span>Delete</span>
        </ConfirmationButton>
        <Button
          appearance="base"
          onClick={async () => navigate(`${ROOT_PATH}/ui/network-integrations`)}
        >
          Cancel
        </Button>
        <ActionButton
          appearance="positive"
          loading={formik.isSubmitting}
          disabled={!formik.isValid || formik.isSubmitting || !formik.dirty}
          onClick={() => void formik.submitForm()}
        >
          Save changes
        </ActionButton>
      </FormFooterLayout>
    </BaseLayout>
  );
};

export default EditNetworkIntegration;
