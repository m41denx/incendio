import { type FC } from "react";
import { RadioInput, Icon } from "@canonical/react-components";
import type { FormikProps } from "formik";
import type { ImageRegistryFormValues } from "types/forms/image";
import { Link } from "react-router-dom";

interface Props {
  formik: FormikProps<ImageRegistryFormValues>;
}
export const ImageRegistryProtocolSelector: FC<Props> = ({ formik }) => {
  return (
    <div className="image-registry-protocol-selector">
      <div>
        <label htmlFor="protocol">Protocol</label>
        <Link
          to="https://linuxcontainers.org/incus/docs/main/reference/remote_image_servers/#remote-server-types"
          target="_blank"
          rel="noopener noreferrer"
          className="help-text help-link"
          title="Learn more about remote server types."
        >
          <Icon name="help" className="help-link-icon" />
        </Link>
      </div>
      <div id="protocol">
        <RadioInput
          inline
          aria-label="Incus"
          labelClassName="incus-protocol-input"
          label="Incus"
          checked={formik.values.protocol === "incus"}
          onChange={() => {
            formik.setFieldValue("protocol", "incus");
          }}
        />
        <RadioInput
          inline
          aria-label="SimpleStreams"
          label="SimpleStreams"
          checked={formik.values.protocol === "simplestreams"}
          onChange={() => {
            formik.setFieldValue("protocol", "simplestreams");
          }}
        />
      </div>
    </div>
  );
};
