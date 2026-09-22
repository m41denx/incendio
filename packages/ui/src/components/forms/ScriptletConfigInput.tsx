import type { FC } from "react";
import classnames from "classnames";
import ReactCodeMirror from "@uiw/react-codemirror";
import { bespin } from "@uiw/codemirror-theme-bespin";

// Props are injected by `getConfigurationRow` via cloneElement (id, name, value,
// onChange) plus an explicit `disabled` set at the call site. CodeMirror's
// onChange yields a raw string, so we wrap it in a synthetic event that
// formik.handleChange can consume.
interface Props {
  id?: string;
  name?: string;
  value?: string;
  onChange?: (event: {
    target: { name?: string; id?: string; value: string };
  }) => void;
  disabled?: boolean;
}

const ScriptletConfigInput: FC<Props> = ({
  id,
  name,
  value,
  onChange,
  disabled,
}) => {
  return (
    <div
      className={classnames("code-editor-wrapper", { "read-only": disabled })}
    >
      <ReactCodeMirror
        id={id}
        value={value ?? ""}
        readOnly={disabled}
        theme={bespin}
        height="250px"
        basicSetup={{ lineNumbers: true, foldGutter: true }}
        onChange={(newValue: string) => {
          onChange?.({ target: { name, id, value: newValue } });
        }}
      />
    </div>
  );
};

export default ScriptletConfigInput;
