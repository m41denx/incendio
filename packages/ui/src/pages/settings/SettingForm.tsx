import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
import {
  Button,
  Icon,
  ThemeSwitcher,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { updateClusteredSettings, updateSettings } from "api/server";
import type { ConfigField } from "types/config";
import { queryKeys } from "util/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "context/auth";
import SettingFormCheckbox from "./SettingFormCheckbox";
import SettingFormInput from "./SettingFormInput";
import SettingFormSelect from "./SettingFormSelect";
import SettingFormPassword from "./SettingFormPassword";
import LoginProjectSelect from "./LoginProjectSelect";
import ImageServersForm from "./ImageServersForm";
import { IMAGE_SERVERS_KEY } from "util/imageServers";
import ResourceLabel from "components/ResourceLabel";
import { useServerEntitlements } from "util/entitlements/server";
import ClusteredSettingFormInput from "./ClusteredSettingFormInput";
import type { ClusterSpecificValues } from "types/cluster";
import { useIsClustered } from "context/useIsClustered";

interface Props {
  configField: ConfigField;
  onDelete: (key: string) => void;
  value?: string;
  clusteredValue?: ClusterSpecificValues;
  onSuccess?: (message: ReactNode) => void;
}

const SettingForm: FC<Props> = ({
  configField,
  onDelete,
  value,
  clusteredValue,
  onSuccess,
}) => {
  const { isRestricted } = useAuth();
  const [isEditMode, setEditMode] = useState(false);
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { canEditServerConfiguration } = useServerEntitlements();
  const isClustered = useIsClustered();

  const editRef = useRef<HTMLDivElement | null>(null);

  // Special cases
  const isTrustPassword = configField.key === "core.trust_password";
  const isLokiAuthPassword = configField.key === "loki.auth.password";
  const isSecret = isTrustPassword || isLokiAuthPassword;
  const isClusteredInput = isClustered && configField.scope === "local";
  const isThemeSelector = configField.key === "user.ui.theme";
  const isLoginProjectSelector = configField.key === "user.ui.default_project";
  const isImageServers = configField.key === IMAGE_SERVERS_KEY;

  // Server settings whose values are a fixed enumeration → render a dropdown
  // instead of a free-text field. Values from the Incus config-option docs.
  const compressionOptions = [
    { label: "none", value: "none" },
    { label: "bzip2", value: "bzip2" },
    { label: "gzip", value: "gzip" },
    { label: "lz4", value: "lz4" },
    { label: "lzma", value: "lzma" },
    { label: "xz", value: "xz" },
    { label: "zstd", value: "zstd" },
  ];
  const selectOptionsByKey: Record<string, { label: string; value: string }[]> =
    {
      "acme.challenge": [
        { label: "HTTP-01", value: "HTTP-01" },
        { label: "DNS-01", value: "DNS-01" },
      ],
      "backups.compression_algorithm": compressionOptions,
      "images.compression_algorithm": compressionOptions,
      "instances.nic.host_name": [
        { label: "random", value: "random" },
        { label: "mac", value: "mac" },
      ],
    };
  const selectOptions = selectOptionsByKey[configField.key];

  const settingLabel = (
    <ResourceLabel bold type="setting" value={configField.key} />
  );

  const onSubmit = (newValue: string | boolean | ClusterSpecificValues) => {
    const mutation =
      isClusteredInput || typeof newValue === "object"
        ? updateClusteredSettings(
            newValue as ClusterSpecificValues,
            configField.key,
          )
        : updateSettings({ [configField.key]: String(newValue) });

    mutation
      .then(() => {
        const message = <>Setting {settingLabel} updated.</>;
        if (onSuccess) {
          onSuccess(message);
        } else {
          toastNotify.success(message);
        }

        setEditMode(false);
      })
      .catch((e) => {
        notify.failure("Setting update failed", e, settingLabel);
      })
      .finally(() => {
        queryClient.invalidateQueries({
          queryKey: [queryKeys.settings],
        });
        queryClient.invalidateQueries({
          queryKey: [queryKeys.settings, queryKeys.cluster],
        });
      });
  };

  const onCancel = () => {
    setEditMode(false);
  };

  const getReadModeValue = () => {
    // special case: secret values are provided by the api as boolean for the read mode
    if (isSecret) {
      return <em>{value ? "set" : "not set"}</em>;
    }
    if (typeof value === "boolean") {
      return String(value);
    }
    return value ? value : "-";
  };

  useEffect(() => {
    if (isEditMode) {
      editRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [isEditMode]);

  if (isClusteredInput) {
    return (
      <ClusteredSettingFormInput
        key={`${JSON.stringify(clusteredValue)}-${isEditMode}`}
        initialValue={clusteredValue ?? {}}
        disableReason={
          canEditServerConfiguration()
            ? undefined
            : "You do not have permission to edit server configuration"
        }
        configField={configField}
        onSubmit={onSubmit}
        onCancel={onCancel}
        readonly={!isEditMode}
        toggleReadOnly={() => {
          setEditMode(true);
        }}
      />
    );
  }

  if (isThemeSelector) {
    return <ThemeSwitcher />;
  }

  if (isLoginProjectSelector) {
    return (
      <div ref={editRef}>
        <LoginProjectSelect configField={configField} />
      </div>
    );
  }

  if (isImageServers) {
    return (
      <div ref={editRef}>
        <ImageServersForm configField={configField} value={value} />
      </div>
    );
  }

  return (
    <>
      {isEditMode && (
        <div ref={editRef}>
          {isSecret && (
            <SettingFormPassword
              isSet={Boolean(value)}
              configField={configField}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          )}
          {!isSecret && (
            <>
              {configField.type === "bool" ? (
                <SettingFormCheckbox
                  initialValue={value}
                  configField={configField}
                  onSubmit={onSubmit}
                  onCancel={onCancel}
                />
              ) : selectOptions ? (
                <SettingFormSelect
                  initialValue={value ?? ""}
                  configField={configField}
                  options={selectOptions}
                  onSubmit={onSubmit}
                  onDelete={onDelete}
                  onCancel={onCancel}
                />
              ) : (
                <SettingFormInput
                  initialValue={value ?? ""}
                  configField={configField}
                  onSubmit={onSubmit}
                  onDelete={onDelete}
                  onCancel={onCancel}
                />
              )}
            </>
          )}
        </div>
      )}
      {!isEditMode && (
        <>
          {isRestricted ? (
            <span>{value ?? "-"}</span>
          ) : (
            <Button
              appearance="base"
              className="readmode-button u-no-margin"
              onClick={() => {
                setEditMode(true);
              }}
              hasIcon
              disabled={!canEditServerConfiguration()}
              title={
                canEditServerConfiguration()
                  ? ""
                  : "You do not have permission to edit server configuration"
              }
            >
              <div className="readmode-value u-truncate">
                {getReadModeValue()}
              </div>
              <Icon name="edit" className="edit-icon" />
            </Button>
          )}
        </>
      )}
    </>
  );
};

export default SettingForm;
