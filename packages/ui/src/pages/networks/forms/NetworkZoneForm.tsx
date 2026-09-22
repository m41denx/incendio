import type { FC, ReactNode } from "react";
import { Form, Input } from "@canonical/react-components";
import type { FormikProps } from "formik";
import type { LxdNetworkZone } from "types/network";

export interface NetworkZoneFormValues {
  name: string;
  description?: string;
  // Comma-separated list stored under the dns.nameservers config key.
  dnsNameservers?: string;
  // Original config carried so a PUT doesn't drop keys the form doesn't render.
  config?: Record<string, string>;
  isCreating: boolean;
  readOnly?: boolean;
  etag?: string;
}

export const toNetworkZone = (
  values: NetworkZoneFormValues,
): LxdNetworkZone => {
  const nameservers = (values.dnsNameservers ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join(",");
  // Rebuild config without dns.nameservers (avoids a dynamic delete), then set
  // it only when non-empty; other carried keys are preserved.
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(values.config ?? {})) {
    if (key !== "dns.nameservers") {
      config[key] = value;
    }
  }
  if (nameservers) {
    config["dns.nameservers"] = nameservers;
  }

  return {
    name: values.name,
    description: values.description,
    config,
    etag: values.etag,
  };
};

export const toNetworkZoneFormValues = (
  zone: LxdNetworkZone,
): NetworkZoneFormValues => {
  return {
    name: zone.name,
    description: zone.description,
    dnsNameservers: zone.config?.["dns.nameservers"] ?? "",
    config: zone.config ?? {},
    isCreating: false,
    readOnly: true,
    etag: zone.etag,
  };
};

interface Props {
  formik: FormikProps<NetworkZoneFormValues>;
}

const NetworkZoneForm: FC<Props> = ({ formik }) => {
  const getError = (id: keyof NetworkZoneFormValues): ReactNode =>
    formik.touched[id] ? (formik.errors[id] as ReactNode) : null;

  return (
    <Form onSubmit={formik.handleSubmit} className="network-zone-form">
      {/* hidden submit to enable enter key in inputs */}
      <Input type="submit" hidden value="Hidden input" />
      <Input
        id="name"
        name="name"
        type="text"
        label="Name"
        required
        disabled={!formik.values.isCreating}
        help={
          formik.values.isCreating
            ? "The DNS zone name, e.g. example.net"
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
      <Input
        id="dnsNameservers"
        name="dnsNameservers"
        type="text"
        label="DNS nameservers"
        placeholder="ns1.example.net, ns2.example.net"
        help="Comma-separated nameservers advertised for this zone (dns.nameservers)."
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.dnsNameservers ?? ""}
      />
    </Form>
  );
};

export default NetworkZoneForm;
