import { useState, type FC } from "react";
import { Link } from "react-router-dom";
import {
  ActionButton,
  ConfirmationButton,
  Notification,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "context/useSettings";
import { installPlacementScriptlet } from "api/placement-groups";
import { queryKeys } from "util/queryKeys";
import { ROOT_PATH } from "util/rootPath";
import {
  PLACEMENT_SCRIPTLET_KEY,
  placementScriptletState,
} from "util/placementGroups";

interface Props {
  hasGroups: boolean;
}

// Whether the groups on this page are actually enforced: they only are while
// Incendio's scriptlet is the cluster's instances.placement.scriptlet.
const PlacementScriptletStatus: FC<Props> = ({ hasGroups }) => {
  const { data: settings } = useSettings();
  const queryClient = useQueryClient();
  const toastNotify = useToastNotification();
  const [installing, setInstalling] = useState(false);
  const state = placementScriptletState(
    settings?.config?.[PLACEMENT_SCRIPTLET_KEY],
  );

  const install = () => {
    setInstalling(true);
    installPlacementScriptlet()
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
        toastNotify.success("Placement scriptlet installed.");
      })
      .catch((e) => {
        toastNotify.failure("Installing the placement scriptlet failed", e);
      })
      .finally(() => {
        setInstalling(false);
      });
  };

  const scriptletLink = (
    <Link to={`${ROOT_PATH}/ui/cluster/settings`}>cluster settings</Link>
  );

  if (state === "current") {
    return (
      <p className="u-text--muted">
        Enforced by Incendio&apos;s placement scriptlet whenever Incus places an
        instance itself: creation without a target, evacuation and rebalancing.
        Changing a group does not move running instances.
      </p>
    );
  }
  if (state === "custom") {
    return (
      <Notification
        severity="caution"
        title="Placement groups are not enforced"
      >
        <p>
          The cluster runs a custom placement scriptlet ({scriptletLink}), and
          Incus allows only one. Replacing it with Incendio&apos;s enforces
          these groups but removes your custom placement logic.
        </p>
        <ConfirmationButton
          appearance="negative"
          loading={installing}
          disabled={installing}
          confirmationModalProps={{
            title: "Replace the placement scriptlet",
            children: (
              <p>
                This replaces the cluster&apos;s custom placement scriptlet with
                Incendio&apos;s. Copy it from {scriptletLink} first if you want
                to keep it.
              </p>
            ),
            confirmButtonLabel: "Replace",
            onConfirm: install,
          }}
        >
          Replace with Incendio&apos;s scriptlet
        </ConfirmationButton>
      </Notification>
    );
  }
  if (state === "outdated") {
    return (
      <Notification severity="information" title="Placement scriptlet update">
        <p>
          A newer version of Incendio&apos;s placement scriptlet is available.
        </p>
        <ActionButton
          loading={installing}
          disabled={installing}
          onClick={install}
        >
          Update scriptlet
        </ActionButton>
      </Notification>
    );
  }
  // Not installed: creating the first group installs it.
  if (!hasGroups) return null;
  return (
    <Notification severity="caution" title="Placement groups are not enforced">
      <p>
        The placement scriptlet that enforces these groups is not installed.
      </p>
      <ActionButton
        appearance="positive"
        loading={installing}
        disabled={installing}
        onClick={install}
      >
        Install scriptlet
      </ActionButton>
    </Notification>
  );
};

export default PlacementScriptletStatus;
