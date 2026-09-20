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
import NetworkAddressSetForm, {
  toNetworkAddressSet,
  type NetworkAddressSetFormValues,
} from "pages/networks/forms/NetworkAddressSetForm";
import { createNetworkAddressSet } from "api/network-address-sets";

const CreateNetworkAddressSet: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { project } = useParams<{ project: string }>();
  const controllerState = useState<AbortController | null>(null);

  if (!project) {
    return <>Missing project</>;
  }

  const AddressSetSchema = Yup.object().shape({
    name: Yup.string()
      .test(
        "deduplicate",
        "An address set with this name already exists",
        async (value) =>
          checkDuplicateName(
            value,
            project,
            controllerState,
            "network-address-sets",
          ),
      )
      .required("Name is required"),
  });

  const getAddressSetUrl = (name: string) =>
    `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-set/${encodeURIComponent(name)}`;

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.projects, project, queryKeys.networkAddressSets],
    });
  };

  const formik = useFormik<NetworkAddressSetFormValues>({
    initialValues: {
      name: "",
      addresses: "",
      isCreating: true,
      readOnly: false,
    },
    validationSchema: AddressSetSchema,
    onSubmit: (values) => {
      const addressSet = toNetworkAddressSet(values);
      createNetworkAddressSet(addressSet, project)
        .then(() => {
          invalidateCache();
          toastNotify.success(
            <>
              Address set{" "}
              <ResourceLink
                type="network-acl"
                value={addressSet.name}
                to={getAddressSetUrl(addressSet.name)}
              />{" "}
              created.
            </>,
          );
          navigate(
            `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-sets`,
          );
        })
        .catch((e) => {
          formik.setSubmitting(false);
          notify.failure(
            `Creation of address set ${addressSet.name} failed`,
            e,
          );
        });
    },
  });

  return (
    <BaseLayout
      title={
        <HelpLink
          docPath="/howto/network_address_sets/"
          title="Learn more about network address sets"
        >
          Create an address set
        </HelpLink>
      }
      contentClassName="create-network-address-set"
    >
      <Row>
        <NotificationRow />
        <NetworkAddressSetForm formik={formik} />
      </Row>
      <FormFooterLayout>
        <Button
          appearance="base"
          onClick={async () =>
            navigate(
              `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-sets`,
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

export default CreateNetworkAddressSet;
