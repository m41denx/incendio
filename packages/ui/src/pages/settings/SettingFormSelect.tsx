import { useState, type FC } from "react";
import { Button, Form, Icon, Select } from "@canonical/react-components";
import type { ConfigField } from "types/config";
import ConfigFieldDescription from "pages/settings/ConfigFieldDescription";

interface Props {
  initialValue: string;
  configField: ConfigField;
  options: { label: string; value: string }[];
  onSubmit: (newValue: string | boolean) => void;
  onDelete: (key: string) => void;
  onCancel: () => void;
}

const SettingFormSelect: FC<Props> = ({
  initialValue,
  configField,
  options,
  onSubmit,
  onDelete,
  onCancel,
}) => {
  const [value, setValue] = useState(
    initialValue || String(configField.default ?? ""),
  );

  const canBeReset =
    !configField.isUserDefined && String(configField.default) !== String(value);

  const resetToDefault = () => {
    setValue(String(configField.default ?? ""));
  };

  // Make sure the current value is always selectable even if it is not one of
  // the well-known options (e.g. a custom compression command).
  const selectOptions = options.some((option) => option.value === value)
    ? options
    : [...options, { label: value, value }];

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <Select
        autoFocus
        aria-label={configField.key}
        id={configField.key}
        wrapperClassName="input-wrapper"
        options={selectOptions}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        help={<ConfigFieldDescription description={configField.longdesc} />}
      />
      <Button appearance="base" onClick={onCancel}>
        Cancel
      </Button>
      <Button appearance="positive" type="submit">
        Save
      </Button>
      {configField.isUserDefined && (
        <Button
          appearance="base"
          hasIcon
          className="delete-button"
          type="button"
          onClick={() => {
            onDelete(configField.key);
          }}
        >
          <Icon name="delete"></Icon>
          <span>Delete</span>
        </Button>
      )}
      {canBeReset && (
        <Button
          className="reset-button"
          appearance="base"
          onClick={resetToDefault}
          hasIcon
        >
          <Icon name="restart" className="flip-horizontally" />
          <span>Reset to default</span>
        </Button>
      )}
    </Form>
  );
};

export default SettingFormSelect;
