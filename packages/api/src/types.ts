export type * from "./api/types/generated";
export type {
  IncusAsyncResponse,
  IncusErrorResponse,
  IncusResponse,
  IncusSyncResponse,
} from "./api/base/types";
export type { IncusEvent, EventOf } from "./api/events";
export type { InstanceNVRAM } from "./api/instance_children";
export type { OperationList } from "./api/operations";
export type { StorageVolumeType } from "./api/storage";
export type { DeepPartial, Input, Nullable } from "./utils/types";

/** Well-known instance statuses (`Instance.status`). */
export type InstanceStatus =
  | "Running"
  | "Stopped"
  | "Frozen"
  | "Error"
  | "Ready"
  | "Starting"
  | "Stopping"
  | "Aborting"
  | "Freezing"
  | "Thawed"
  | (string & {});

/** Operation statuses (`Operation.status`). */
export type OperationStatus =
  | "Pending"
  | "Running"
  | "Cancelling"
  | "Success"
  | "Failure"
  | "Cancelled"
  | (string & {});
