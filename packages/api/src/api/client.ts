import type { AxiosInstance } from "axios";
import { createContext } from "./base/agent";
import type { IncusClientOptions, RequestContext } from "./base/types";
import { Certificates } from "./certificates";
import { ClusterClient } from "./cluster";
import { Events } from "./events";
import { Images } from "./images";
import { InstanceClient, Instances } from "./instances";
import {
  NetworkAcls,
  NetworkAddressSets,
  NetworkClient,
  NetworkIntegrations,
  NetworkZones,
  Networks,
} from "./networks";
import { Operations } from "./operations";
import { Profiles, Projects, Warnings } from "./projects";
import { ServerClient } from "./server";
import { StoragePoolClient, StoragePools } from "./storage";

/**
 * Stateless wrapper over the Incus REST API. Every method is one HTTP call
 * returning the response `metadata`; async endpoints return the `Operation`
 * (await it with `client.operations.wait(op)`).
 *
 * @example
 * const client = new IncusAPIClient({ url: "https://incus:8443", project: "default" });
 * const op = await client.instance("web").setState({ action: "start" });
 * await client.operations.wait(op);
 */
export class IncusAPIClient {
  protected readonly ctx: RequestContext;

  readonly server: ServerClient;
  readonly certificates: Certificates;
  readonly cluster: ClusterClient;
  readonly events: Events;
  readonly images: Images;
  readonly instances: Instances;
  readonly networks: Networks;
  readonly networkAcls: NetworkAcls;
  readonly networkAddressSets: NetworkAddressSets;
  readonly networkIntegrations: NetworkIntegrations;
  readonly networkZones: NetworkZones;
  readonly operations: Operations;
  readonly profiles: Profiles;
  readonly projects: Projects;
  readonly storagePools: StoragePools;
  readonly warnings: Warnings;

  constructor(options: IncusClientOptions | RequestContext = {}) {
    this.ctx = "r" in options ? options : createContext(options);
    const ctx = this.ctx;
    this.server = new ServerClient(ctx);
    this.certificates = new Certificates(ctx);
    this.cluster = new ClusterClient(ctx);
    this.events = new Events(ctx);
    this.images = new Images(ctx);
    this.instances = new Instances(ctx);
    this.networks = new Networks(ctx);
    this.networkAcls = new NetworkAcls(ctx);
    this.networkAddressSets = new NetworkAddressSets(ctx);
    this.networkIntegrations = new NetworkIntegrations(ctx);
    this.networkZones = new NetworkZones(ctx);
    this.operations = new Operations(ctx);
    this.profiles = new Profiles(ctx);
    this.projects = new Projects(ctx);
    this.storagePools = new StoragePools(ctx);
    this.warnings = new Warnings(ctx);
  }

  /** The underlying axios instance. */
  get $r(): AxiosInstance {
    return this.ctx.r;
  }

  /** Default project of this client (undefined = server default). */
  get project(): string | undefined {
    return this.ctx.project;
  }

  /** Default cluster member target of this client. */
  get target(): string | undefined {
    return this.ctx.target;
  }

  /** A client sharing this connection, scoped to another project. */
  withProject(project: string | undefined): IncusAPIClient {
    return new IncusAPIClient({ ...this.ctx, project });
  }

  /** A client sharing this connection, targeting a cluster member. */
  withTarget(target: string | undefined): IncusAPIClient {
    return new IncusAPIClient({ ...this.ctx, target });
  }

  /** One instance: state, exec, console, files, snapshots, backups, logs, … */
  instance(name: string): InstanceClient {
    return new InstanceClient(this.ctx, name);
  }

  /** One network: state, leases, forwards, load balancers, peers. */
  network(name: string): NetworkClient {
    return new NetworkClient(this.ctx, name);
  }

  /** One storage pool: volumes and buckets. */
  storagePool(name: string): StoragePoolClient {
    return new StoragePoolClient(this.ctx, name);
  }
}
