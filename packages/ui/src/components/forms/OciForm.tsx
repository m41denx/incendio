import type { FC } from "react";
import { Input } from "@canonical/react-components";
import classnames from "classnames";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import { getConfigurationRow } from "components/ConfigurationRow";
import ScrollableConfigurationTable from "components/forms/ScrollableConfigurationTable";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";
export { ociPayload } from "util/instanceAndProfilePayloads";

interface Props {
  formik: InstanceAndProfileFormikProps;
}

const OciForm: FC<Props> = ({ formik }) => {
  const isInstance = formik.values.entityType === "instance";
  const isContainerOnlyDisabled =
    isInstance &&
    (formik.values as CreateInstanceFormValues).instanceType !== "container";

  const textRow = (name: string, label: string) =>
    getConfigurationRow({
      formik,
      label,
      name,
      defaultValue: "",
      disabled: isContainerOnlyDisabled,
      disabledReason: isContainerOnlyDisabled
        ? "Only available for containers"
        : undefined,
      children: (
        <Input
          type="text"
          disabled={isContainerOnlyDisabled}
          labelClassName={classnames({
            "is-disabled": isContainerOnlyDisabled,
          })}
        />
      ),
    });

  return (
    <ScrollableConfigurationTable
      rows={[
        textRow("oci_entrypoint", "Override the OCI image entrypoint"),
        textRow("oci_cwd", "Working directory"),
        textRow("oci_uid", "UID to run the entrypoint as"),
        textRow("oci_gid", "GID to run the entrypoint as"),
        textRow("oci_dns_domain", "DNS domain"),
        textRow("oci_dns_nameservers", "DNS nameservers"),
        textRow("oci_dns_search", "DNS search domains"),
      ]}
    />
  );
};

export default OciForm;
