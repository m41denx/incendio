import { useState, useEffect, useRef, type FC } from "react";
import {
  ActionButton,
  Button,
  EmptyState,
  Icon,
  Notification,
  RadioInput,
  useNotify,
  usePortal,
} from "@canonical/react-components";
import InstanceGraphicConsole from "./InstanceGraphicConsole";
import type { LxdInstance } from "types/instance";
import InstanceTextConsole from "./InstanceTextConsole";
import InstancePreview from "./InstancePreview";
import { useInstanceStart } from "util/instanceStart";
import AttachIsoBtn from "pages/instances/actions/AttachIsoBtn";
import NotificationRow from "components/NotificationRow";
import ConsoleConfirmation from "components/forms/ConsoleConfirmation";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { useInstanceEntitlements } from "util/entitlements/instances";
import { isInstanceRunning } from "util/instanceStatus";
import InstanceConsoleShortcuts from "pages/instances/InstanceConsoleShortcuts";
import { useOperations } from "context/operationsProvider";
import { findOperation } from "util/operations";
import { useIsMinimalConsole } from "util/minimalConsole";

interface Props {
  instance: LxdInstance;
}

const InstanceConsole: FC<Props> = ({ instance }) => {
  const notify = useNotify();
  const isVm = instance.type === "virtual-machine";
  const isMinimalConsole = useIsMinimalConsole();
  const [isGraphic, setGraphic] = useState(isVm);
  const { hasCustomVolumeIso } = useSupportedFeatures();
  const { canUpdateInstanceState, canAccessInstanceConsole } =
    useInstanceEntitlements();

  const isRunning = isInstanceRunning(instance);

  const [attemptConnection, setAttemptConnection] = useState({
    attempt: isRunning,
    force: false,
  });
  const [showPreview, setShowPreview] = useState(false);
  const { openPortal, closePortal, isOpen, Portal } = usePortal();
  const { operations } = useOperations();
  const lastOp = useRef({ restart: "", start: "", stop: "" });
  const [showConnectBtn, setShowConnectBtn] = useState(false);

  const clearErrorOnStop = () => {
    const isStopped = instance.status === "Stopped";
    if (!isStopped) {
      return;
    }

    if (isGraphic) {
      notify.clear();
    } else {
      showNotRunningInfo();
    }
  };

  useEffect(clearErrorOnStop, [instance.status, notify.notification]);

  const onPreviewFailure = (title: string, e: unknown) => {
    notify.failure(title, e);
  };

  const onFailure = (title: string, e: unknown, message?: string) => {
    setShowConnectBtn(true);
    setShowPreview(true);
    setAttemptConnection({ attempt: false, force: false });
    if (hasActiveSession(e instanceof Error ? e.message : String(e))) {
      openPortal();
    } else {
      notify.failure(title, e, message);
    }
  };

  const hasActiveSession = (e: string) => {
    if (!e) {
      return false;
    }

    return e
      .toLowerCase()
      .includes(
        "this console is already connected. force is required to take it over",
      );
  };

  const showNotRunningInfo = () => {
    notify.info(
      "Start the instance to interact with the text console.",
      "Instance not running",
    );
  };

  let handleFullScreen = () => {
    /**/
  };

  const handleConnection = () => {
    setShowConnectBtn(false);
    setShowPreview(false);
    setAttemptConnection({ attempt: true, force: false });
  };

  const handleConnectionConfirm = () => {
    closePortal();
    setShowConnectBtn(false);
    setShowPreview(false);
    setAttemptConnection({ attempt: true, force: true });
  };

  const onChildMount = (childHandleFullScreen: () => void) => {
    handleFullScreen = childHandleFullScreen;
  };

  const setGraphicConsole = (isGraphic: boolean) => {
    notify.clear();
    setGraphic(isGraphic);
    setShowConnectBtn(false);
    setShowPreview(false);
    setAttemptConnection({ attempt: true, force: false });
  };

  const { handleStart, isLoading } = useInstanceStart(instance);

  if (!canAccessInstanceConsole(instance)) {
    return (
      <Notification severity="caution" title="Restricted permissions">
        You do not have permission to access the console for this instance.
      </Notification>
    );
  }

  useEffect(() => {
    // Check if there are any relevant instance operations.
    const restartOp = findOperation(
      instance,
      operations,
      "Restarting instance",
    );

    if (restartOp) {
      if (
        restartOp.status == "Success" &&
        lastOp.current["restart"] != restartOp.created_at
      ) {
        // Reconnect console if restart operation was detected.
        lastOp.current["restart"] = restartOp.created_at;
        setAttemptConnection({ attempt: false, force: false });
        setShowPreview(false);
        setTimeout(() => {
          setAttemptConnection({ attempt: true, force: false });
        }, 2000);
      }
    }

    const startOp = findOperation(instance, operations, "Starting instance");
    if (startOp) {
      // Disconect console if start operation was detected.
      if (
        lastOp.current["start"] != startOp.created_at &&
        startOp.status == "Success"
      ) {
        lastOp.current["start"] = startOp.created_at;
        setAttemptConnection({ attempt: false, force: false });
        setShowPreview(false);
        setTimeout(() => {
          setAttemptConnection({ attempt: true, force: false });
        }, 2000);
      }
    }

    const stopOp = findOperation(instance, operations, "Stopping instance");
    if (stopOp) {
      // Disconect console if stop operation was detected.
      setAttemptConnection({ attempt: false, force: false });
      if (
        stopOp.status == "Success" &&
        lastOp.current["stop"] != stopOp.created_at
      ) {
        setShowConnectBtn(false);
        setShowPreview(false);
        lastOp.current["stop"] = stopOp.created_at;
      }
    }
  }, [operations, attemptConnection, showConnectBtn]);

  return (
    <div className="instance-console-tab">
      {!isVm && (
        <div className="p-panel__controls">
          {isRunning && showConnectBtn && (
            <Button
              className="u-no-margin--bottom control-button"
              hasIcon
              onClick={() => {
                handleConnection();
              }}
            >
              <Icon name="connected" />
              <span>Reconnect</span>
            </Button>
          )}
        </div>
      )}
      {isVm && (
        <div className="p-panel__controls">
          <div className="console-radio-wrapper">
            <RadioInput
              labelClassName="right-margin"
              label="Graphic"
              checked={isGraphic}
              onChange={() => {
                setGraphicConsole(true);
              }}
            />
            <RadioInput
              label="Text console"
              checked={!isGraphic}
              onChange={() => {
                setGraphicConsole(false);
              }}
            />
          </div>
          <div>
            {showConnectBtn && (
              <Button
                className="u-no-margin--bottom"
                hasIcon
                onClick={() => {
                  handleConnection();
                }}
              >
                <Icon name="connected" />
                <span>Reconnect</span>
              </Button>
            )}
            {isGraphic && hasCustomVolumeIso && !isMinimalConsole && (
              <AttachIsoBtn instance={instance} />
            )}
            {isGraphic && (
              <>
                <Button
                  className="u-no-margin--bottom"
                  disabled={!isRunning}
                  title={
                    isRunning
                      ? undefined
                      : "Start the instance to enter fullscreen"
                  }
                  onClick={() => {
                    handleFullScreen();
                  }}
                  hasIcon
                >
                  <Icon name="fullscreen" />
                  <span>Fullscreen</span>
                </Button>
                <InstanceConsoleShortcuts disabled={!isRunning} />
              </>
            )}
          </div>
        </div>
      )}
      <NotificationRow />
      {isGraphic && !isRunning && (
        <EmptyState
          className="empty-state"
          image={<Icon name="pods" className="empty-state-icon" />}
          title="Instance stopped"
        >
          <p>Start the instance to access the graphic console.</p>
          <ActionButton
            appearance="positive"
            loading={isLoading}
            aria-disabled={isLoading}
            onClick={handleStart}
            disabled={!canUpdateInstanceState(instance) || isLoading}
            title={
              canUpdateInstanceState(instance)
                ? ""
                : "You do not have permission to start this instance."
            }
          >
            Start instance
          </ActionButton>
        </EmptyState>
      )}
      {isGraphic && attemptConnection["attempt"] && (
        <div className="spice-wrapper">
          <InstanceGraphicConsole
            instance={instance}
            force={attemptConnection["force"]}
            onMount={onChildMount}
            onFailure={onFailure}
          />
        </div>
      )}
      {isGraphic && showPreview && (
        <div style={{ textAlign: "center" }}>
          Read-only view
          <InstancePreview
            instance={instance}
            refetch={true}
            onFailure={onPreviewFailure}
          />
        </div>
      )}
      {!isGraphic && attemptConnection["attempt"] && (
        <InstanceTextConsole
          instance={instance}
          force={attemptConnection["force"]}
          onFailure={onFailure}
          showNotRunningInfo={showNotRunningInfo}
        />
      )}
      {isOpen && (
        <Portal>
          <ConsoleConfirmation
            onConfirm={handleConnectionConfirm}
            close={closePortal}
          />
        </Portal>
      )}
    </div>
  );
};

export default InstanceConsole;
