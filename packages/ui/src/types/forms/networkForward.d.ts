export interface NetworkForwardFormValues {
  listenAddress: string;
  defaultTargetAddress?: string;
  description?: string;
  ports: NetworkForwardPortFormValues[];
  location?: string;
  // Bridged networks only: apply a matching SNAT for each DNAT.
  snat?: boolean;
}

export interface NetworkForwardPortFormValues {
  listenPort: string;
  protocol: "tcp" | "udp";
  targetAddress: string;
  targetPort?: string;
}
