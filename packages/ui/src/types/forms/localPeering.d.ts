export interface LocalPeeringFormValues {
  name: string;
  targetProject: string;
  targetNetwork: string;
  description?: string;
  customTargetProject?: string;
  customTargetNetwork?: string;
  createMutualPeering?: boolean;
  // "local" (peer another network) or "remote" (peer through an OVN
  // interconnect network integration).
  peerType?: string;
  targetIntegration?: string;
}
