import { Collection, RenamableCollection } from "./base/collection";
import { Resource } from "./base/request";
import type { ListOptions, RequestContext, ScopeOptions } from "./base/types";
import type {
  Network,
  NetworkACL,
  NetworkACLPut,
  NetworkACLsPost,
  NetworkAddressSet,
  NetworkAddressSetPut,
  NetworkAddressSetsPost,
  NetworkAllocations,
  NetworkForward,
  NetworkForwardPut,
  NetworkForwardsPost,
  NetworkIntegration,
  NetworkIntegrationPut,
  NetworkIntegrationsPost,
  NetworkLease,
  NetworkLoadBalancer,
  NetworkLoadBalancerPut,
  NetworkLoadBalancerState,
  NetworkLoadBalancersPost,
  NetworkPeer,
  NetworkPeerPut,
  NetworkPeersPost,
  NetworkPut,
  NetworkState,
  NetworkZone,
  NetworkZonePut,
  NetworkZoneRecord,
  NetworkZoneRecordPut,
  NetworkZoneRecordsPost,
  NetworkZonesPost,
  NetworksPost,
} from "./types/generated";
import type { Input } from "../utils/types";
import { path } from "../utils/path";

/** `/1.0/networks` */
export class Networks extends RenamableCollection<
  Network,
  Input<NetworksPost, "name">,
  NetworkPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["networks"]);
  }

  /** Addresses in use across networks (API extension: `network_allocations`). */
  async allocations(opts?: ListOptions): Promise<NetworkAllocations[]> {
    return (
      (await this.sync<NetworkAllocations[]>(
        "GET",
        path("network-allocations"),
        {
          params: this.listScope(opts),
        },
      )) ?? []
    );
  }
}

/** `/1.0/networks/{network}/forwards`, keyed by listen address. */
export class NetworkForwards extends Collection<
  NetworkForward,
  Input<NetworkForwardsPost, "listen_address">,
  NetworkForwardPut
> {
  constructor(ctx: RequestContext, network: string) {
    super(ctx, ["networks", network, "forwards"]);
  }
}

/** `/1.0/networks/{network}/load-balancers`, keyed by listen address. */
export class NetworkLoadBalancers extends Collection<
  NetworkLoadBalancer,
  Input<NetworkLoadBalancersPost, "listen_address">,
  NetworkLoadBalancerPut
> {
  constructor(ctx: RequestContext, network: string) {
    super(ctx, ["networks", network, "load-balancers"]);
  }

  /** Backend health (API extension: `network_load_balancer_state`). */
  async state(
    listenAddress: string,
    opts?: ScopeOptions,
  ): Promise<NetworkLoadBalancerState> {
    return this.sync<NetworkLoadBalancerState>(
      "GET",
      this.url(listenAddress, "state"),
      { params: this.scope(opts) },
    );
  }
}

/** `/1.0/networks/{network}/peers` */
export class NetworkPeers extends Collection<
  NetworkPeer,
  Input<NetworkPeersPost, "name">,
  NetworkPeerPut
> {
  constructor(ctx: RequestContext, network: string) {
    super(ctx, ["networks", network, "peers"]);
  }
}

/** `/1.0/networks/{name}` — one network's state, leases and sub-resources. */
export class NetworkClient extends Resource {
  readonly name: string;
  readonly forwards: NetworkForwards;
  readonly loadBalancers: NetworkLoadBalancers;
  readonly peers: NetworkPeers;

  constructor(ctx: RequestContext, name: string) {
    super(ctx);
    this.name = name;
    this.forwards = new NetworkForwards(ctx, name);
    this.loadBalancers = new NetworkLoadBalancers(ctx, name);
    this.peers = new NetworkPeers(ctx, name);
  }

  private url(...segments: string[]): string {
    return path("networks", this.name, ...segments);
  }

  /** Runtime state: addresses, counters, bridge/bond/VLAN/OVN details. */
  async state(opts?: ScopeOptions): Promise<NetworkState> {
    return this.sync<NetworkState>("GET", this.url("state"), {
      params: this.scope(opts),
    });
  }

  /** DHCP leases (managed bridges / OVN). */
  async leases(opts?: ScopeOptions): Promise<NetworkLease[]> {
    return (
      (await this.sync<NetworkLease[]>("GET", this.url("leases"), {
        params: this.scope(opts),
      })) ?? []
    );
  }
}

/** `/1.0/network-acls` */
export class NetworkAcls extends RenamableCollection<
  NetworkACL,
  Input<NetworkACLsPost, "name">,
  NetworkACLPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["network-acls"]);
  }

  /** Firewall log entries for the ACL (OVN). */
  async log(name: string, opts?: ScopeOptions): Promise<string> {
    const { data } = await this.request<string>("GET", this.url(name, "log"), {
      params: this.scope(opts),
      responseType: "text",
    });
    return data;
  }
}

/** `/1.0/network-address-sets` (API extension: `network_address_set`) */
export class NetworkAddressSets extends RenamableCollection<
  NetworkAddressSet,
  Input<NetworkAddressSetsPost, "name">,
  NetworkAddressSetPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["network-address-sets"]);
  }
}

/** `/1.0/network-integrations` (API extension: `network_integrations`) */
export class NetworkIntegrations extends RenamableCollection<
  NetworkIntegration,
  Input<NetworkIntegrationsPost, "name">,
  NetworkIntegrationPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["network-integrations"]);
  }
}

/** `/1.0/network-zones/{zone}/records` */
export class NetworkZoneRecords extends Collection<
  NetworkZoneRecord,
  Input<NetworkZoneRecordsPost, "name">,
  NetworkZoneRecordPut
> {
  constructor(ctx: RequestContext, zone: string) {
    super(ctx, ["network-zones", zone, "records"]);
  }
}

/** `/1.0/network-zones` */
export class NetworkZones extends Collection<
  NetworkZone,
  Input<NetworkZonesPost, "name">,
  NetworkZonePut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["network-zones"]);
  }

  /** Records of one zone. */
  records(zone: string): NetworkZoneRecords {
    return new NetworkZoneRecords(this.ctx, zone);
  }
}
