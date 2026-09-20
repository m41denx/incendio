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
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { queryKeys } from "util/queryKeys";
import { ROOT_PATH } from "util/rootPath";
import NotificationRow from "components/NotificationRow";
import BaseLayout from "components/BaseLayout";
import FormFooterLayout from "components/forms/FormFooterLayout";
import NetworkAddressSetForm, {
  toNetworkAddressSet,
  toNetworkAddressSetFormValues,
  type NetworkAddressSetFormValues,
} from "pages/networks/forms/NetworkAddressSetForm";
import { useNetworkAddressSet } from "context/useNetworkAddressSets";
import {
  deleteNetworkAddressSet,
  updateNetworkAddressSet,
} from "api/network-address-sets";

const EditNetworkAddressSet: FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { name, project } = useParams<{ name: string; project: string }>();

  if (!name) {
    return <>Missing name</>;
  }

  if (!project) {
    return <>Missing project</>;
  }

  const {
    data: addressSet,
    error,
    isLoading,
  } = useNetworkAddressSet(name, project);

  useEffect(() => {
    if (error) {
      notify.failure("Loading address set failed", error);
    }
  }, [error]);

  const invalidateCache = () => {
    queryClient.invalidateQueries({
      queryKey: [queryKeys.projects, project, queryKeys.networkAddressSets],
    });
  };

  const formik = useFormik<NetworkAddressSetFormValues>({
    initialValues: addressSet
      ? toNetworkAddressSetFormValues(addressSet)
      : { name, addresses: "", isCreating: false, readOnly: true },
    enableReinitialize: true,
    onSubmit: (values) => {
      const payload = toNetworkAddressSet(values);
      updateNetworkAddressSet(payload, project)
        .then(() => {
          invalidateCache();
          toastNotify.success(`Address set ${payload.name} updated.`);
          navigate(
            `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-sets`,
          );
        })
        .catch((e) => {
          formik.setSubmitting(false);
          notify.failure(`Update of address set ${payload.name} failed`, e);
        });
    },
  });

  const handleDelete = () => {
    deleteNetworkAddressSet(name, project)
      .then(() => {
        invalidateCache();
        toastNotify.success(`Address set ${name} deleted.`);
        navigate(
          `${ROOT_PATH}/ui/project/${encodeURIComponent(project)}/network-address-sets`,
        );
      })
      .catch((e) => {
        notify.failure(`Deletion of address set ${name} failed`, e);
      });
  };

  if (isLoading) {
    return <Spinner className="u-loader" text="Loading..." isMainComponent />;
  }

  const usedByCount = (addressSet?.used_by ?? []).length;

  return (
    <BaseLayout
      title={`Edit ${name}`}
      contentClassName="edit-network-address-set"
    >
      <Row>
        <NotificationRow />
        <NetworkAddressSetForm formik={formik} />
      </Row>
      <FormFooterLayout>
        <ConfirmationButton
          appearance="base"
          className="has-icon"
          disabled={usedByCount > 0}
          title={
            usedByCount > 0
              ? "This address set is in use and cannot be deleted"
              : "Delete address set"
          }
          confirmationModalProps={{
            title: "Confirm deletion",
            children: (
              <p>
                This will permanently delete the address set{" "}
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
          disabled={formik.isSubmitting || !formik.dirty}
          onClick={() => void formik.submitForm()}
        >
          Save changes
        </ActionButton>
      </FormFooterLayout>
    </BaseLayout>
  );
};

export default EditNetworkAddressSet;
