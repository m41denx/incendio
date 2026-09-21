import type { FC } from "react";
import { CheckboxInput, Input, Select } from "@canonical/react-components";
import type { FormikProps } from "formik";
import type { NetworkDeviceFormValues } from "types/forms/networkDevice";
import { macvlanType, sriovType, ovnType } from "util/networks";

interface Props {
  formik: FormikProps<NetworkDeviceFormValues>;
  networkType?: string;
}

const MACVLAN_MODE_OPTIONS = [
  { label: "Default (bridge)", value: "" },
  { label: "bridge", value: "bridge" },
  { label: "vepa", value: "vepa" },
  { label: "passthru", value: "passthru" },
  { label: "private", value: "private" },
];

// Renders the NIC device options that only apply to a specific nictype, which is
// derived from the selected managed network's type. Keys map to the Incus device
// config (mode, vlan, security.trusted, nested, ipv4/ipv6.routes).
const NetworkDeviceTypeOptions: FC<Props> = ({ formik, networkType }) => {
  const toggle = (field: keyof NetworkDeviceFormValues) => () => {
    const current = formik.values[field] === "true";
    void formik.setFieldValue(field, current ? "" : "true");
  };

  if (networkType === macvlanType) {
    return (
      <>
        <Select
          id="macvlan_mode"
          label="Macvlan mode"
          options={MACVLAN_MODE_OPTIONS}
          help="How the macvlan interface relates to its parent."
          {...formik.getFieldProps("macvlan_mode")}
        />
        <Input
          id="vlan"
          label="VLAN ID"
          type="number"
          help="VLAN ID to attach the interface to (optional)."
          {...formik.getFieldProps("vlan")}
        />
      </>
    );
  }

  if (networkType === sriovType) {
    return (
      <>
        <CheckboxInput
          id="security_trusted"
          label="Trusted (security.trusted)"
          checked={formik.values.security_trusted === "true"}
          onChange={toggle("security_trusted")}
        />
        <p className="p-form-help-text u-no-margin--top">
          Let the instance reconfigure the NIC (VLANs, promiscuous mode). Used
          for SR-IOV passthrough on VMs.
        </p>
        <CheckboxInput
          id="security_mac_filtering"
          label="MAC filtering (security.mac_filtering)"
          checked={formik.values.security_mac_filtering === "true"}
          onChange={toggle("security_mac_filtering")}
        />
        <p className="p-form-help-text u-no-margin--top">
          Prevent the instance from spoofing another instance&rsquo;s MAC
          address.
        </p>
        <Input
          id="vlan"
          label="VLAN ID"
          type="number"
          help="VLAN ID to attach the interface to (optional)."
          {...formik.getFieldProps("vlan")}
        />
      </>
    );
  }

  if (networkType === ovnType) {
    return (
      <>
        <Input
          id="nested"
          label="Nested parent NIC"
          type="text"
          help="Nest this NIC under another NIC on the instance (requires a VLAN ID)."
          {...formik.getFieldProps("nested")}
        />
        <Input
          id="vlan"
          label="Nesting VLAN ID"
          type="number"
          help="VLAN ID used when nesting under the parent NIC."
          {...formik.getFieldProps("vlan")}
        />
        <Input
          id="ipv4_routes"
          label="IPv4 static routes"
          type="text"
          help="Comma-separated IPv4 routes to route to this NIC."
          {...formik.getFieldProps("ipv4_routes")}
        />
        <Input
          id="ipv6_routes"
          label="IPv6 static routes"
          type="text"
          help="Comma-separated IPv6 routes to route to this NIC."
          {...formik.getFieldProps("ipv6_routes")}
        />
      </>
    );
  }

  return null;
};

export default NetworkDeviceTypeOptions;
