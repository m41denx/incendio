import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  Row,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "util/queryKeys";
import { checkDuplicateName } from "util/helpers";
import { ROOT_PATH } from "util/rootPath";
import NotificationRow from "components/NotificationRow";
import BaseLayout from "components/BaseLayout";
import FormFooterLayout from "components/forms/FormFooterLayout";
import ResourceLink from "components/ResourceLink";
import NetworkIntegrationForm, {
  toNetworkIntegration,
  type NetworkIntegrationFormValues,
} from "pages/networks/forms/NetworkIntegrationForm";
import { createNetworkIntegration } from "api/network-integrations";

const CreateNetworkIntegration: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const controllerState = useState<AbortController | null>(null);

  const IntegrationSchema = Yup.object().shape({
    name: Yup.string()
      .test(
        "deduplicate",
        "A network integration with this name already exists",
        async (value) =>
          checkDuplicateName(
            value,
            "",
            controllerState,
            "network-integrations",
          ),
      )
      .required("Name is required"),
    ovnNorthboundConnection: Yup.string().required(
      "An OVN northbound connection is required",
    ),
  });

  const getIntegrationUrl = (name: string) =>
    `${ROOT_PATH}/ui/network-integration/${encodeURIComponent(name)}`;

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.networkIntegrations],
    });
  };

  const formik = useFormik<NetworkIntegrationFormValues>({
    initialValues: {
      name: "",
      integrationType: "ovn",
      isCreating: true,
      readOnly: false,
    },
    validationSchema: IntegrationSchema,
    onSubmit: (values) => {
      const integration = toNetworkIntegration(values);
      createNetworkIntegration(integration)
        .then(() => {
          invalidateCache();
          toastNotify.success(
            <>
              Network integration{" "}
              <ResourceLink
                type="network"
                value={integration.name}
                to={getIntegrationUrl(integration.name)}
              />{" "}
              created.
            </>,
          );
          navigate(`${ROOT_PATH}/ui/network-integrations`);
        })
        .catch((e) => {
          formik.setSubmitting(false);
          notify.failure(
            `Creation of network integration ${integration.name} failed`,
            e,
          );
        });
    },
  });

  return (
    <BaseLayout
      title="Create a network integration"
      contentClassName="create-network-integration"
    >
      <Row>
        <NotificationRow />
        <NetworkIntegrationForm formik={formik} />
      </Row>
      <FormFooterLayout>
        <Button
          appearance="base"
          onClick={async () => navigate(`${ROOT_PATH}/ui/network-integrations`)}
        >
          Cancel
        </Button>
        <ActionButton
          appearance="positive"
          loading={formik.isSubmitting}
          disabled={
            !formik.isValid ||
            formik.values.name.length === 0 ||
            formik.isSubmitting
          }
          onClick={() => void formik.submitForm()}
        >
          Create
        </ActionButton>
      </FormFooterLayout>
    </BaseLayout>
  );
};

export default CreateNetworkIntegration;
