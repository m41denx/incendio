import { IncusAPIClient } from "./api/client";
import type { IncusClientOptions } from "./api/base/types";
import { DEFAULT_REMOTES, type ImageRemote } from "./utils/helpers";
import { IncusClient } from "./humane/Client";

export interface CreateIncusClientOptions extends IncusClientOptions {
  /** Extra image remotes for `"remote:alias"` references (merged with the defaults). */
  remotes?: Record<string, ImageRemote>;
}

/**
 * Creates a Humane Incus client.
 *
 * @example
 * // Browser, same origin as the Incus UI (TLS client cert / OIDC cookie handled by the browser)
 * const client = createIncusClient();
 *
 * // Node: see `nodeTransport` in `@incendio/api/node`
 * const client = createIncusClient({ ...nodeTransport(), project: "default" });
 */
export const createIncusClient = (
  options: CreateIncusClientOptions = {},
): IncusClient => {
  const { remotes, ...rest } = options;
  return new IncusClient(new IncusAPIClient(rest), {
    ...DEFAULT_REMOTES,
    ...remotes,
  });
};

export { IncusClient } from "./humane/Client";
export type { CreateInstanceOptions } from "./humane/Client";
export { IncusOperation } from "./humane/Operation";
export type { OperationWaitOptions } from "./humane/Operation";
export { Instance } from "./humane/Instance";
export type {
  ExecOptions,
  ExecResult,
  StateChangeOptions,
} from "./humane/Instance";
export { InstanceSnapshot } from "./humane/InstanceSnapshot";
export { InstanceBackup } from "./humane/InstanceBackup";
export { ExecSession } from "./humane/ExecSession";
export type { ExecStream } from "./humane/ExecSession";
export { Image } from "./humane/Image";
export { Profile } from "./humane/Profile";
export { Project } from "./humane/Project";
export { Network } from "./humane/Network";
export { Certificate } from "./humane/Certificate";
export { ClusterMember } from "./humane/ClusterMember";
export { StoragePool } from "./humane/StoragePool";
export type { CreateVolumeOptions } from "./humane/StoragePool";
export { StorageVolume } from "./humane/StorageVolume";
export type { VolumeSnapshot } from "./humane/StorageVolume";

export { IncusAPIClient } from "./api/client";
export { IncusError, IncusOperationError } from "./api/base/types";
export type {
  IncusClientOptions,
  ScopeOptions,
  ListOptions,
  WebSocketConnector,
  WebSocketLike,
} from "./api/base/types";
export {
  DEFAULT_REMOTES,
  applyConfig,
  formatSize,
  imageSource,
  parseSize,
} from "./utils/helpers";
export type { ConfigChanges, ImageRemote } from "./utils/helpers";
