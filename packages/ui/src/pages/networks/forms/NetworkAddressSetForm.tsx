import type { FC, ReactNode } from "react";
import { Form, Input } from "@canonical/react-components";
import type { FormikProps } from "formik";
import AutoExpandingTextArea from "components/AutoExpandingTextArea";
import type { LxdNetworkAddressSet } from "types/network";

export interface NetworkAddressSetFormValues {
  name: string;
  description?: string;
  // One address (IP, CIDR or range) per line in the form.
  addresses: string;
  isCreating: boolean;
  readOnly?: boolean;
  etag?: string;
}

const parseAddresses = (value: string): string[] =>
  value
    .split(/\r?\n|,/)
    .map((address) => address.trim())
    .filter((address) => address.length > 0);

export const toNetworkAddressSet = (
  values: NetworkAddressSetFormValues,
): LxdNetworkAddressSet => {
  return {
    name: values.name,
    description: values.description,
    addresses: parseAddresses(values.addresses),
    etag: values.etag,
  };
};

export const toNetworkAddressSetFormValues = (
  addressSet: LxdNetworkAddressSet,
): NetworkAddressSetFormValues => {
  return {
    name: addressSet.name,
    description: addressSet.description,
    addresses: (addressSet.addresses ?? []).join("\n"),
    isCreating: false,
    readOnly: true,
    etag: addressSet.etag,
  };
};

interface Props {
  formik: FormikProps<NetworkAddressSetFormValues>;
}

const NetworkAddressSetForm: FC<Props> = ({ formik }) => {
  const getError = (id: keyof NetworkAddressSetFormValues): ReactNode =>
    formik.touched[id] ? (formik.errors[id] as ReactNode) : null;

  return (
    <Form onSubmit={formik.handleSubmit} className="network-address-set-form">
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
      <AutoExpandingTextArea
        id="addresses"
        name="addresses"
        label="Addresses"
        placeholder={"192.0.2.1\n192.0.2.0/24\n192.0.2.10-192.0.2.20"}
        help="One IP address, CIDR subnet or IP range per line."
        onBlur={formik.handleBlur}
        onChange={formik.handleChange}
        value={formik.values.addresses}
        rows={5}
      />
    </Form>
  );
};

export default NetworkAddressSetForm;
