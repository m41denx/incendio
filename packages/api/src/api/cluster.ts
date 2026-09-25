import { EntityCollection, RenamableCollection } from "./base/collection";
import { Resource } from "./base/request";
import type {
  EtagOptions,
  RequestContext,
  ScopeOptions,
  WithEtag,
} from "./base/types";
import type {
  Cluster,
  ClusterCertificatePut,
  ClusterGroup,
  ClusterGroupPut,
  ClusterGroupsPost,
  ClusterMember,
  ClusterMemberPut,
  ClusterMemberState,
  ClusterPut,
  Operation,
} from "./types/generated";
import type { Input } from "../utils/types";
import { path } from "../utils/path";

/** `/1.0/cluster/members` */
export class ClusterMembers extends EntityCollection<
  ClusterMember,
  ClusterMemberPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["cluster", "members"]);
  }

  /**
   * Issues a join token for a new member. The token operation's metadata
   * holds the token fields.
   */
  async createJoinToken(serverName: string): Promise<Operation> {
    return this.op("POST", this.url(), { data: { server_name: serverName } });
  }

  async rename(name: string, newName: string): Promise<void> {
    await this.request("POST", this.url(name), {
      data: { server_name: newName },
    });
  }

  /** Removes a member. `force` removes it even if it is unreachable. */
  override async delete(
    name: string,
    opts?: ScopeOptions & { force?: boolean },
  ): Promise<void> {
    await this.request("DELETE", this.url(name), {
      params: { force: opts?.force ? 1 : undefined },
    });
  }

  /** Member resource usage (storage pools, sysinfo). */
  async state(name: string): Promise<ClusterMemberState> {
    return this.sync<ClusterMemberState>("GET", this.url(name, "state"));
  }

  /**
   * Evacuates (`evacuate`) or restores (`restore`) a member.
   * `mode` overrides `cluster.evacuate` (e.g. `stop`, `migrate`, `live-migrate`).
   */
  async setState(
    name: string,
    action: "evacuate" | "restore",
    mode?: string,
  ): Promise<Operation> {
    return this.op("POST", this.url(name, "state"), {
      data: { action, mode },
    });
  }
}

/** `/1.0/cluster/groups` */
export class ClusterGroups extends RenamableCollection<
  ClusterGroup,
  Input<ClusterGroupsPost, "name">,
  ClusterGroupPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["cluster", "groups"]);
  }
}

/** `/1.0/cluster` — cluster settings, members and groups. */
export class ClusterClient extends Resource {
  readonly members: ClusterMembers;
  readonly groups: ClusterGroups;

  constructor(ctx: RequestContext) {
    super(ctx);
    this.members = new ClusterMembers(ctx);
    this.groups = new ClusterGroups(ctx);
  }

  async info(): Promise<Cluster> {
    return this.sync<Cluster>("GET", path("cluster"));
  }

  async infoWithEtag(): Promise<WithEtag<Cluster>> {
    return this.syncEtag<Cluster>(path("cluster"));
  }

  /** Enables clustering or joins an existing cluster. */
  async update(
    body: Input<ClusterPut>,
    opts?: EtagOptions,
  ): Promise<Operation | null> {
    return this.maybeOp("PUT", path("cluster"), {
      data: body,
      etag: opts?.etag,
    });
  }

  /** Replaces the cluster certificate on all members. */
  async updateCertificate(body: ClusterCertificatePut): Promise<void> {
    await this.request("PUT", path("cluster", "certificate"), { data: body });
  }
}
