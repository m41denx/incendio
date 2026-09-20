import type { FC, ReactNode } from "react";
import { Input, Select, Textarea } from "@canonical/react-components";
import type { FormikProps } from "formik";
import type { LxdNetworkIntegration } from "types/network";

export interface NetworkIntegrationFormValues {
  name: string;
  description?: string;
  integrationType: string;
  ovnNorthboundConnection?: string;
  ovnTransitPattern?: string;
  ovnCaCert?: string;
  ovnClientCert?: string;
  ovnClientKey?: string;
  isCreating: boolean;
  readOnly?: boolean;
  etag?: string;
}

export const toNetworkIntegration = (
  values: NetworkIntegrationFormValues,
): LxdNetworkIntegration => {
  const config: Record<string, string> = {};
  if (values.ovnNorthboundConnection) {
    config["ovn.northbound_connection"] = values.ovnNorthboundConnection;
  }
  if (values.ovnTransitPattern) {
    config["ovn.transit.pattern"] = values.ovnTransitPattern;
  }
  if (values.ovnCaCert) {
    config["ovn.ca_cert"] = values.ovnCaCert;
  }
  if (values.ovnClientCert) {
    config["ovn.client_cert"] = values.ovnClientCert;
  }
  if (values.ovnClientKey) {
    config["ovn.client_key"] = values.ovnClientKey;
  }

  return {
    name: values.name,
    description: values.description,
    type: values.integrationType,
    config,
    etag: values.etag,
  };
};

export const toNetworkIntegrationFormValues = (
  integration: LxdNetworkIntegration,
): NetworkIntegrationFormValues => {
  const config = integration.config ?? {};
  return {
    name: integration.name,
    description: integration.description,
    integrationType: integration.type || "ovn",
    ovnNorthboundConnection: config["ovn.northbound_connection"],
    ovnTransitPattern: config["ovn.transit.pattern"],
    ovnCaCert: config["ovn.ca_cert"],
    ovnClientCert: config["ovn.client_cert"],
    ovnClientKey: config["ovn.client_key"],
    isCreating: false,
    readOnly: true,
    etag: integration.etag,
  };
};

interface Props {
  formik: FormikProps<NetworkIntegrationFormValues>;
}

const NetworkIntegrationForm: FC<Props> = ({ formik }) => {
  const getError = (id: keyof NetworkIntegrationFormValues): ReactNode =>
    formik.touched[id] ? (formik.errors[id] as ReactNode) : null;

  return (
    <div className="network-integration-form">
      <Input
        id="name"
        name="name"
        type="text"
        label="Name"
        required
        disabled={!formik.values.isCreating}
        help={
          formik.values.isCreating
            ? undefined
            : "Name cannot be changed after creation"
        }
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.name}
        error={getError("name")}
      />
      <Input
        id="description"
        name="description"
        type="text"
        label="Description"
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.description ?? ""}
        error={getError("description")}
      />
      <Select
        id="integrationType"
        name="integrationType"
        label="Type"
        help="OVN interconnection is the only supported integration type"
        options={[{ label: "OVN", value: "ovn" }]}
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.integrationType}
        disabled
      />
      <Input
        id="ovnNorthboundConnection"
        name="ovnNorthboundConnection"
        type="text"
        label="OVN northbound connection"
        required
        placeholder="tcp:10.0.0.1:6645"
        help="Connection string for the OVN interconnection northbound database"
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.ovnNorthboundConnection ?? ""}
        error={getError("ovnNorthboundConnection")}
      />
      <Input
        id="ovnTransitPattern"
        name="ovnTransitPattern"
        type="text"
        label="Transit switch pattern"
        placeholder="ts-incus-{{ integration.name }}"
        help="Optional Pongo2 template used to generate the transit switch name"
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.ovnTransitPattern ?? ""}
        error={getError("ovnTransitPattern")}
      />
      <Textarea
        id="ovnCaCert"
        name="ovnCaCert"
        label="CA certificate"
        rows={4}
        help="Optional SSL CA certificate for the OVN interconnection database"
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.ovnCaCert ?? ""}
      />
      <Textarea
        id="ovnClientCert"
        name="ovnClientCert"
        label="Client certificate"
        rows={4}
        help="Optional SSL client certificate to connect to the OVN interconnection database"
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.ovnClientCert ?? ""}
      />
      <Textarea
        id="ovnClientKey"
        name="ovnClientKey"
        label="Client key"
        rows={4}
        help="Optional SSL client key to connect to the OVN interconnection database"
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.ovnClientKey ?? ""}
      />
    </div>
  );
};

export default NetworkIntegrationForm;
