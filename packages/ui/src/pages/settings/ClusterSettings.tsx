import type { FC } from "react";
import { useFormik } from "formik";
import {
  ActionButton,
  CustomLayout,
  Form,
  Input,
  Notification,
  Row,
  Spinner,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import ReactCodeMirror from "@uiw/react-codemirror";
import { bespin } from "@uiw/codemirror-theme-bespin";
import { useQueryClient } from "@tanstack/react-query";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import { useSettings } from "context/useSettings";
import { updateSettings } from "api/server";
import { queryKeys } from "util/queryKeys";
import { useServerEntitlements } from "util/entitlements/server";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { useCurrentProject } from "context/useCurrentProject";
import { placementScriptletState } from "util/placementGroups";
import { ROOT_PATH } from "util/rootPath";
import { Link } from "react-router-dom";

interface ClusterSettingsValues {
  rebalanceInterval: string;
  rebalanceThreshold: string;
  rebalanceBatch: string;
  rebalanceCooldown: string;
  healingThreshold: string;
  offlineThreshold: string;
  scriptlet: string;
}

const ClusterSettings: FC = () => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettings();
  const { canEditServerConfiguration } = useServerEntitlements();
  const { hasClusterRebalance, hasPlacementScriptlet } = useSupportedFeatures();
  const { project } = useCurrentProject();

  const config = settings?.config ?? {};

  const formik = useFormik<ClusterSettingsValues>({
    enableReinitialize: true,
    initialValues: {
      rebalanceInterval: config["cluster.rebalance.interval"] ?? "",
      rebalanceThreshold: config["cluster.rebalance.threshold"] ?? "",
      rebalanceBatch: config["cluster.rebalance.batch"] ?? "",
      rebalanceCooldown: config["cluster.rebalance.cooldown"] ?? "",
      healingThreshold: config["cluster.healing_threshold"] ?? "",
      offlineThreshold: config["cluster.offline_threshold"] ?? "",
      scriptlet: config["instances.placement.scriptlet"] ?? "",
    },
    onSubmit: (values) => {
      const payload: Record<string, string> = {
        "cluster.rebalance.interval": values.rebalanceInterval,
        "cluster.rebalance.threshold": values.rebalanceThreshold,
        "cluster.rebalance.batch": values.rebalanceBatch,
        "cluster.rebalance.cooldown": values.rebalanceCooldown,
        "cluster.healing_threshold": values.healingThreshold,
        "cluster.offline_threshold": values.offlineThreshold,
        "instances.placement.scriptlet": values.scriptlet,
      };
      updateSettings(payload)
        .then(() => {
          toastNotify.success("Cluster settings updated.");
          queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
        })
        .catch((e) => {
          notify.failure("Updating cluster settings failed", e);
        });
    },
  });

  return (
    <CustomLayout
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/explanation/clustering/"
                title="Learn more about clustering"
              >
                Cluster settings
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
        </PageHeader>
      }
      contentClassName="settings"
    >
      <NotificationRow />
      <Row>
        {!canEditServerConfiguration() ? (
          <Notification
            severity="caution"
            title="Restricted permissions"
            titleElement="h2"
          >
            You do not have permission to view or edit server settings
          </Notification>
        ) : isLoading ? (
          <Spinner className="u-loader" text="Loading..." />
        ) : (
          <Form onSubmit={formik.handleSubmit}>
            {hasClusterRebalance && (
              <>
                <h2 className="p-heading--4">Automatic re-balancing</h2>
                <p className="u-text--muted">
                  Periodically live-migrate instances to balance load across
                  cluster members.
                </p>
                <Input
                  type="number"
                  label="Interval (minutes)"
                  help="How often to consider re-balancing. 0 disables it (default)."
                  {...formik.getFieldProps("rebalanceInterval")}
                />
                <Input
                  type="number"
                  label="Threshold (%)"
                  help="Load difference between busiest and least-busy member needed to trigger a move."
                  {...formik.getFieldProps("rebalanceThreshold")}
                />
                <Input
                  type="number"
                  label="Batch size"
                  help="Maximum number of instances to move during one re-balancing run."
                  {...formik.getFieldProps("rebalanceBatch")}
                />
                <Input
                  type="text"
                  label="Cooldown"
                  help="Time during which a moved instance will not be moved again (e.g. 6H or 30m)."
                  {...formik.getFieldProps("rebalanceCooldown")}
                />
                <Input
                  type="number"
                  label="Healing threshold (seconds)"
                  help="Seconds after which instances are auto-evacuated from an offline member. 0 disables."
                  {...formik.getFieldProps("healingThreshold")}
                />
                <Input
                  type="number"
                  label="Offline threshold (seconds)"
                  help="Seconds after which an unresponsive member is considered offline."
                  {...formik.getFieldProps("offlineThreshold")}
                />
              </>
            )}
            {hasPlacementScriptlet && (
              <>
                <h2 className="p-heading--4">Placement scriptlet</h2>
                <p className="u-text--muted">
                  A Starlark <code>instance_placement</code> scriptlet that
                  chooses a cluster member for new instances. Incus uses this in
                  place of placement groups.
                </p>
                {placementScriptletState(formik.values.scriptlet) !== "none" &&
                placementScriptletState(formik.values.scriptlet) !==
                  "custom" ? (
                  <Notification severity="caution" title="Managed by Incendio">
                    This scriptlet enforces the{" "}
                    <Link
                      to={`${ROOT_PATH}/ui/project/${encodeURIComponent(project?.name ?? "default")}/placement-groups`}
                    >
                      placement groups
                    </Link>
                    . Editing it can break them, and Incendio replaces it when
                    it ships a new version; manage the groups instead.
                  </Notification>
                ) : null}
                <div className="code-editor-wrapper">
                  <ReactCodeMirror
                    value={formik.values.scriptlet}
                    theme={bespin}
                    height="300px"
                    basicSetup={{ lineNumbers: true, foldGutter: true }}
                    onChange={(value: string) => {
                      void formik.setFieldValue("scriptlet", value);
                    }}
                  />
                </div>
              </>
            )}
            <ActionButton
              className="u-sv2"
              appearance="positive"
              loading={formik.isSubmitting}
              disabled={!formik.dirty || formik.isSubmitting}
              onClick={() => void formik.submitForm()}
            >
              Save changes
            </ActionButton>
          </Form>
        )}
      </Row>
    </CustomLayout>
  );
};

export default ClusterSettings;
