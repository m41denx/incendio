import type { FC } from "react";
import { Button, Icon, Input } from "@canonical/react-components";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import type { EditInstanceFormValues } from "types/forms/instanceAndProfile";
import { getConfigurationRowBase } from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";
import { focusField } from "util/formFields";
import { ensureEditMode } from "util/editMode";

export interface CredentialPropertyFormValues {
  name: string;
  value: string;
  nameEditable: boolean;
}

// SMBIOS Type 11 strings and systemd credentials are free-form key/value config
// keys (smbios11.<name>, systemd.credential.<name>,
// systemd.credential-binary.<name>). They are edited here as raw key/value pairs.
export const CREDENTIAL_PREFIXES = [
  "smbios11.",
  "systemd.credential.",
  "systemd.credential-binary.",
];

export const credentialPropertiesFromConfig = (
  config: Record<string, string | undefined>,
): [string, string][] => {
  return Object.entries(config ?? {}).filter(([k]) =>
    CREDENTIAL_PREFIXES.some((prefix) => k.startsWith(prefix)),
  ) as [string, string][];
};

const credentialPropertiesFromValues = (
  formik: InstanceAndProfileFormikProps,
) => {
  const properties = (
    formik.values as { credentialProperties?: CredentialPropertyFormValues[] }
  ).credentialProperties;
  return (properties ?? []).filter((item) => item.value != null);
};

interface Props {
  formik: InstanceAndProfileFormikProps;
}

const CredentialPropertiesForm: FC<Props> = ({ formik }) => {
  const readOnly = (formik.values as EditInstanceFormValues).readOnly;

  const setProperties = (properties: CredentialPropertyFormValues[]) => {
    void formik.setFieldValue("credentialProperties", properties);
  };

  const addProperty = () => {
    setProperties([
      ...credentialPropertiesFromValues(formik),
      { name: "smbios11.", value: "", nameEditable: true },
    ]);
  };

  const removeProperty = (index: number) => {
    const copy = [...credentialPropertiesFromValues(formik)];
    copy.splice(index, 1);
    setProperties(copy);
  };

  const focusProperty = (index: number) => {
    focusField(`credentialProperties.${index}.name`);
  };

  return (
    <ScrollableConfigurationTable
      rows={[
        ...credentialPropertiesFromValues(formik).map((item, index) => {
          return getConfigurationRowBase({
            configuration:
              readOnly || !item.nameEditable ? (
                <span className="mono-font">{item.name}</span>
              ) : (
                <Input
                  required
                  name={`credentialProperties.${index}.name`}
                  id={`credentialProperties.${index}.name`}
                  onBlur={formik.handleBlur}
                  onChange={formik.handleChange}
                  value={item.name}
                  type="text"
                  placeholder="smbios11.<name> / systemd.credential.<name>"
                  className="u-no-margin--bottom"
                />
              ),
            inherited: "",
            override: (
              <div style={{ display: "flex" }}>
                <div className="u-truncate">
                  {readOnly ? (
                    item.value
                  ) : (
                    <Input
                      required
                      name={`credentialProperties.${index}.value`}
                      id={`credentialProperties.${index}.value`}
                      onBlur={formik.handleBlur}
                      onChange={formik.handleChange}
                      value={item.value}
                      type="text"
                      className="u-no-margin--bottom"
                    />
                  )}
                </div>
                <div>
                  {readOnly ? (
                    <Button
                      onClick={() => {
                        ensureEditMode(formik);
                        focusProperty(index);
                      }}
                      type="button"
                      appearance="base"
                      title={formik.values.editRestriction ?? "Edit"}
                      className="u-no-margin--top"
                      hasIcon
                      dense
                      disabled={!!formik.values.editRestriction}
                    >
                      <Icon name="edit" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        ensureEditMode(formik);
                        removeProperty(index);
                      }}
                      type="button"
                      appearance="base"
                      title="Remove"
                      className="profile-remove-btn"
                      hasIcon
                      dense
                      disabled={!!formik.values.editRestriction}
                    >
                      <Icon name="delete" />
                    </Button>
                  )}
                </div>
              </div>
            ),
          });
        }),

        getConfigurationRowBase({
          configuration: "",
          inherited: "",
          override: (
            <Button
              onClick={() => {
                ensureEditMode(formik);
                addProperty();
              }}
              type="button"
              hasIcon
              disabled={!!formik.values.editRestriction}
              title={formik.values.editRestriction}
            >
              <Icon name="plus" />
              <span>Add credential</span>
            </Button>
          ),
        }),
      ]}
    />
  );
};

export default CredentialPropertiesForm;
