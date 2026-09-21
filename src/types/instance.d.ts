import type { LxdConfigPair } from "./config";
import type { LxdDevices } from "./device";

interface LxdInstanceUsageProp {
  usage: number;
}

interface LxdInstanceCpuUsage {
  usage: number;
  // Total CPU time allocated to the instance (nanoseconds).
  // API extension: instances_state_total.
  allocated_time?: number;
}

interface LxdInstanceMemory {
  swap_usage: number;
  swap_usage_peak: number;
  usage: number;
  usage_peak: number;
}

export type IpFamily = "inet" | "inet6";

interface LxdInstanceNetworkAddress {
  address: string;
  family: IpFamily;
  netmask: string;
  scope: string;
}

export type IpAddress = LxdInstanceNetworkAddress & {
  iface: string;
};

interface LxdInstanceNetworkCounters {
  bytes_received: number;
  bytes_sent: number;
  errors_received: number;
  errors_sent: number;
  packets_dropped_inbound: number;
  packets_dropped_outbound: number;
  packets_received: number;
  packets_sent: number;
}

interface LxdInstanceNetwork {
  addresses: LxdInstanceNetworkAddress[];
  counters: LxdInstanceNetworkCounters;
  host_name: string;
  hwaddr: string;
  mtu: number;
  state: "up" | "down";
  type: string;
}

interface LxdInstanceOSInfo {
  os: string;
  os_version: string;
}

interface LxdInstanceState {
  cpu: LxdInstanceCpuUsage;
  disk: {
    root: LxdInstanceUsageProp;
  } & Record<string, LxdInstanceUsageProp>;
  memory: LxdInstanceMemory;
  network?: Record<string, LxdInstanceNetwork>;
  pid: number;
  processes: number;
  status: string;
  os_info?: LxdInstanceOSInfo;
  // When the instance was last started. API extension: instance_state_started_at.
  started_at?: string;
  etag?: string;
}

interface LxdInstanceSnapshot {
  name: string;
  created_at: string;
  expires_at: string;
  stateful: boolean;
  ephemeral: boolean;
  config: {
    "volatile.base_image"?: string;
  };
}

export type LxdInstanceAction =
  | "freeze"
  | "restart"
  | "start"
  | "stop"
  | "unfreeze";

export type LxdInstanceStatus =
  | "Error"
  | "Freezing"
  | "Frozen"
  | "Restarting"
  | "Running"
  | "Starting"
  | "Stopped"
  | "Stopping"
  | "Migrating";

export interface LxdInstance {
  architecture: string;
  config: {
    "image.description"?: string;
  } & LxdConfigPair;
  created_at: string;
  description: string;
  devices: LxdDevices;
  ephemeral: boolean;
  expanded_config: LxdConfigPair;
  expanded_devices?: LxdDevices;
  last_used_at: string;
  location: string;
  name: string;
  profiles: string[];
  project: string;
  restore?: string;
  snapshots: LxdInstanceSnapshot[] | null;
  state?: LxdInstanceState;
  stateful: boolean;
  status: LxdInstanceStatus;
  type: "container" | "virtual-machine";
  etag?: string;
  access_entitlements?: string[];
}

export type InstanceIconType = "container" | "virtual-machine" | "instance";

// A single UEFI variable, as returned by GET /1.0/instances/{name}/nvram/... .
// `data` is the "dissected" (human-readable) representation the daemon derives
// from the raw bytes; `binary` is the raw byte array.
export interface LxdInstanceNVRAMVariable {
  attributes?: string[];
  binary?: number[];
  data?: unknown;
  timestamp?: string;
}

// GET /1.0/instances/{name}/nvram?recursion=2 returns a map of
// GUID -> variable name -> variable.
export type LxdInstanceNVRAM = Record<
  string,
  Record<string, LxdInstanceNVRAMVariable>
>;
