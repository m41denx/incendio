import type { Db } from "../db/index.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import type { Authz, Tuple } from "./platform.ts";

type Who = { kind: "user" | "service"; id: string };
type Check = (who: Who, id: string) => Promise<boolean>;

/**
 * Today's relation checks (platform, tenant and cluster relations of the
 * former OpenFGA platform store) answered by the ACL, so call sites keep
 * working while they move to `acl.can(privilege, path)`. Each relation is
 * the privilege only its old holders have:
 * - tenant admin is `acl.manage` on the tenant: tenant owners and admins,
 *   and platform admins, but not platform operators;
 * - tenant owner is the membership itself.
 */
export class AclAuthz implements Authz {
  constructor(
    _db: Db,
    readonly acl: Acl,
  ) {}

  private async who(user: string): Promise<Who | null> {
    const id = user.startsWith("user:") ? user.slice(5) : null;
    if (!id) return null;
    return { kind: (await this.acl.lookup()).serviceAccounts.has(id) ? "service" : "user", id };
  }

  private priv = (privilege: Privilege, path: (id: string) => Promise<string | null>): Check => async (who, id) => {
    const p = await path(id);
    return !!p && this.acl.can(who, privilege, p);
  };

  private tenantPath = async (id: string) => {
    const slug = (await this.acl.lookup()).tenantSlugs.get(id);
    return slug ? `/tenants/${slug}` : null;
  };

  private clusterPath = async (id: string) => {
    const name = (await this.acl.lookup()).clusterNames.get(id);
    return name ? `/clusters/${name}` : null;
  };

  private readonly relations: Record<string, Check> = {
    "platform#admin": this.priv("platform.users", async () => "/"),
    "platform#operator": this.priv("cluster.configure", async () => "/"),
    "platform#viewer": this.priv("cluster.view", async () => "/"),
    "tenant#owner": async (who, id) => {
      const l = await this.acl.lookup();
      return who.kind === "user" && !l.disabled.has(`user:${who.id}`) && l.owners.has(`${id}:${who.id}`);
    },
    "tenant#admin": this.priv("acl.manage", this.tenantPath),
    "tenant#member": this.priv("instance.create", this.tenantPath),
    "tenant#viewer": this.priv("tenant.view", this.tenantPath),
    "cluster#admin": this.priv("node.provision", this.clusterPath),
    "cluster#viewer": this.priv("cluster.view", this.clusterPath),
    "cluster#can_access": async (who, id) => {
      const p = await this.clusterPath(id);
      return !!p && this.acl.sees(who, p);
    },
  };

  async check(user: string, relation: string, object: string): Promise<boolean> {
    const who = await this.who(user);
    const [type, id] = object.split(":") as [string, string | undefined];
    const f = this.relations[`${type}#${relation}`];
    return !!(who && id && f) && f(who, id);
  }

  async listObjects(user: string, relation: string, type: string): Promise<string[]> {
    const l = await this.acl.lookup();
    const ids = type === "tenant" ? [...l.tenantSlugs.keys()] : type === "cluster" ? [...l.clusterNames.keys()] : [];
    const out: string[] = [];
    for (const id of ids) if (await this.check(user, relation, `${type}:${id}`)) out.push(`${type}:${id}`);
    return out.sort();
  }

  /** The ACL reads the database: tuples are no longer kept, but a change made here is seen at once. */
  async write(_writes: Tuple[], _deletes: Tuple[] = []): Promise<void> {
    this.acl.invalidate();
  }
}
