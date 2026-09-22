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
import { useNavigate, useParams } from "react-router-dom";
import { queryKeys } from "util/queryKeys";
import { checkDuplicateName } from "util/helpers";
import { ROOT_PATH } from "util/rootPath";
import NotificationRow from "components/NotificationRow";
import BaseLayout from "components/BaseLayout";
import HelpLink from "components/HelpLink";
import FormFooterLayout from "components/forms/FormFooterLayout";
import ResourceLink from "components/ResourceLink";
import NetworkZoneForm, {
  toNetworkZone,
  type NetworkZoneFormValues,
} from "pages/networks/forms/NetworkZoneForm";
import { createNetworkZone } from "api/network-zones";

const CreateNetworkZone: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { project } = useParams<{ project: string }>();
  const controllerState = useState<AbortController | null>(null);

  if (!project) {
    return <>Missing project</>;
  }

  const ZoneSchema = Yup.object().shape({
    name: Yup.string()
      .test(
        "deduplicate",
        "A network zone with this name already exists",
        async (value) =>
          checkDuplicateName(value, project, controllerState, "network-zones"),
      )
      .required("Name is required"),
  });

  const getZoneUrl = (name: string) =>
    `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zone/${encodeURIComponent(name)}`;

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.projects, project, queryKeys.networkZones],
    });
  };

  const formik = useFormik<NetworkZoneFormValues>({
    initialValues: {
      name: "",
      config: {},
      isCreating: true,
      readOnly: false,
    },
    validationSchema: ZoneSchema,
    onSubmit: (values) => {
      const zone = toNetworkZone(values);
      createNetworkZone(zone, project)
        .then(() => {
          invalidateCache();
          toastNotify.success(
            <>
              Network zone{" "}
              <ResourceLink
                type="network-acl"
                value={zone.name}
                to={getZoneUrl(zone.name)}
              />{" "}
              created.
            </>,
          );
          navigate(
            `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-zones`,
          );
        })
        .catch((e) => {
          formik.setSubmitting(false);
          notify.failure(`Creation of network zone ${zone.name} failed`, e);
        });
    },
  });

  return (
    <BaseLayout
      title={
        <HelpLink
          docPath="/howto/network_zones/"
          title="Learn more about network zones"
        >
          Create a network zone
        </HelpLink>
      }
      contentClassName="create-network-zone"
    >
      <Row>
        <NotificationRow />
        <NetworkZoneForm formik={formik} />
      </Row>
      <FormFooterLayout>
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

export default CreateNetworkZone;
