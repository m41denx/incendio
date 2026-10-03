import type { FC, ReactNode } from "react";
import {
  Button,
  EmptyState,
  Icon,
  Notification,
  Spinner,
} from "@canonical/react-components";
import { useNavigate } from "react-router-dom";
import { ROOT_PATH } from "util/rootPath";
import { describeOpenFgaError, type OpenFgaSettings } from "api/openfga";
import {
  useOpenFgaData,
  useOpenFgaSettings,
  type OpenFgaData,
} from "pages/authorization/useOpenFga";

interface Props {
  children: (data: OpenFgaData, settings: OpenFgaSettings) => ReactNode;
}

/**
 * Loads the OpenFGA store for the authorization pages, or explains why it
 * cannot: not configured yet, or not reachable from this browser.
 */
const OpenFgaGate: FC<Props> = ({ children }) => {
  const navigate = useNavigate();
  const { settings, isLoading: isSettingsLoading } = useOpenFgaSettings();
  const { data, error, isLoading, refetch, isFetching } =
    useOpenFgaData(settings);

  const toSetup = () => {
    void navigate(`${ROOT_PATH}/ui/authorization/setup`);
  };

  if (isSettingsLoading || (settings && isLoading)) {
    return <Spinner className="u-loader" text="Loading OpenFGA store..." />;
  }

  if (!settings) {
    return (
      <EmptyState
        className="empty-state"
        image={<Icon name="user" className="empty-state-icon" />}
        title="OpenFGA is not configured"
      >
        <p>
          Connect Incus to an OpenFGA server to grant users and groups access to
          projects, instances and other resources. Only users who can see the
          server&apos;s sensitive settings can manage access here.
        </p>
        <Button appearance="positive" onClick={toSetup}>
          Set up OpenFGA
        </Button>
      </EmptyState>
    );
  }

  if (error || !data) {
    return (
      <Notification
        severity="negative"
        title={`Cannot load the OpenFGA store at ${settings.url}`}
        actions={[
          {
            label: isFetching ? "Retrying..." : "Retry",
            onClick: () => {
              void refetch();
            },
          },
          { label: "Open setup", onClick: toSetup },
        ]}
      >
        {error instanceof Error &&
        error.message.startsWith("The OpenFGA store has no")
          ? error.message
          : describeOpenFgaError(error)}
      </Notification>
    );
  }

  return <>{children(data, settings)}</>;
};

export default OpenFgaGate;
