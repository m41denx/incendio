import {
  ActionButton,
  Button,
  ScrollableContainer,
  SidePanel,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import type { FC } from "react";
import usePanelParams from "util/usePanelParams";
import * as Yup from "yup";
import { useFormik } from "formik";
import NotificationRow from "components/NotificationRow";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import {
  createPlacementGroup,
  fetchPlacementScriptlet,
  installPlacementScriptlet,
} from "api/placement-groups";
import { usePlacementGroups } from "context/usePlacementGroups";
import {
  PLACEMENT_GROUP_NAME,
  placementScriptletState,
} from "util/placementGroups";
import { useCurrentProject } from "context/useCurrentProject";
import type { PlacementGroupFormValues } from "types/forms/placementGroup";
import PlacementGroupForm, {
  PLACEMENT_GROUP_POLICY_COMPACT,
  PLACEMENT_GROUP_RIGOR_STRICT,
} from "pages/placement-groups/PlacementGroupForm";
import ResourceLink from "components/ResourceLink";
import { ROOT_PATH } from "util/rootPath";

const CreatePlacementGroupPanel: FC = () => {
  const panelParams = usePanelParams();
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { project } = useCurrentProject();
  const { data: existing = [] } = usePlacementGroups(project?.name ?? "");

  const closePanel = () => {
    panelParams.clear();
    notify.clear();
  };

  const schema = Yup.object().shape({
    name: Yup.string()
      .test(
        "deduplicate",
        "A placement group with this name already exists",
        (value) => !existing.some((group) => group.name === value),
      )
      .matches(PLACEMENT_GROUP_NAME, {
        message:
          "Name can only contain alphanumeric, hyphen and underscore characters",
      })
      .required("Placement group name is required"),
  });

  const formik = useFormik<PlacementGroupFormValues>({
    initialValues: {
      name: "",
      description: "",
      policy: PLACEMENT_GROUP_POLICY_COMPACT,
      rigor: PLACEMENT_GROUP_RIGOR_STRICT,
    },
    validationSchema: schema,
    onSubmit: () => {
      const placementGroup = {
        name: formik.values.name,
        description: formik.values.description,
        config: {
          policy: formik.values.policy,
          rigor: formik.values.rigor,
        },
      };

      createPlacementGroup(JSON.stringify(placementGroup), project?.name ?? "")
        // The first group installs Incendio's placement scriptlet (and a
        // newer version replaces an older one); a custom scriptlet is left
        // alone and the list page explains why groups are not enforced.
        .then(async () => {
          try {
            const state = placementScriptletState(
              await fetchPlacementScriptlet(),
            );
            if (state === "none" || state === "outdated") {
              await installPlacementScriptlet();
              await queryClient.invalidateQueries({
                queryKey: [queryKeys.settings],
              });
            }
          } catch (e) {
            toastNotify.failure(
              "The group was created, but installing the placement scriptlet failed, so it is not enforced yet",
              e,
            );
          }
        })
        .then(() => {
          toastNotify.success(
            <>
              Placement group{" "}
              <ResourceLink
                type="placement-group"
                value={placementGroup.name ?? ""}
                to={`${ROOT_PATH}/ui/project/${project?.name ?? "default"}/placement-groups/`}
              />{" "}
              created.
            </>,
          );

          queryClient.invalidateQueries({
            queryKey: [queryKeys.placementGroups, project?.name],
          });
          closePanel();
        })
        .catch((e) => {
          notify.failure("Placement group creation failed", e);
          formik.setSubmitting(false);
        });
    },
  });

  return (
    <>
      <SidePanel>
        <SidePanel.Header>
          <SidePanel.HeaderTitle>Create placement group</SidePanel.HeaderTitle>
        </SidePanel.Header>
        <NotificationRow className="u-no-padding" />
        <SidePanel.Content className="u-no-padding">
          <ScrollableContainer
            dependencies={[notify.notification]}
            belowIds={["panel-footer"]}
          >
            <PlacementGroupForm formik={formik} />
          </ScrollableContainer>
        </SidePanel.Content>
        <SidePanel.Footer className="u-align--right">
          <Button
            appearance="base"
            onClick={closePanel}
            className="u-no-margin--bottom"
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            onClick={() => void formik.submitForm()}
            className="u-no-margin--bottom"
            disabled={
              !formik.isValid || formik.isSubmitting || !formik.values.name
            }
            loading={formik.isSubmitting}
          >
            Create
          </ActionButton>
        </SidePanel.Footer>
      </SidePanel>
    </>
  );
};

export default CreatePlacementGroupPanel;
