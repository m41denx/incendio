import type { LxdConfigPair } from "./config";
import type { LxdDevices } from "./device";

// Cross-cluster instance migration via a two-sided "paste" flow.
//
// The source cluster UI starts a migration operation and packages everything a
// remote cluster needs to pull the instance in into an InstanceMigrationBundle.
// The bundle is base64(JSON)-encoded (mirroring Incus' own token style) so it
// can be copied as a single string and pasted into the target cluster UI.
export interface InstanceMigrationBundle {
  instanceName: string;
  instanceType: string;
  architecture: string;
  config: LxdConfigPair;
  devices: LxdDevices;
  profiles: string[];
  ephemeral: boolean;
  description: string;
  addresses: string[];
  certificate: string;
  operation: string;
  secrets: Record<string, string>;
  live: boolean;
}
