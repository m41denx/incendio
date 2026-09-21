export interface NetworkDeviceFormValues {
  name: string;
  network?: string;
  nictype?: string;
  acls?: string;
  ipv4?: string;
  ipv6?: string;
  security_acls_default_ingress_action?: string;
  security_acls_default_egress_action?: string;
  parent?: string;
  // nictype-specific options (shown based on the selected network's type)
  macvlan_mode?: string; // macvlan
  vlan?: string; // macvlan / sriov / ovn (nesting)
  security_trusted?: string; // sriov
  security_mac_filtering?: string; // sriov
  nested?: string; // ovn
  ipv4_routes?: string; // ovn
  ipv6_routes?: string; // ovn
}
