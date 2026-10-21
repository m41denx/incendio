import type { Db } from "../db/index.ts";
import type { Acl } from "../acl/acl.ts";
import type { Authz, Tuple } from "./platform.ts";

type Who = { kind: "user" | "service"; id: string };
type Check = (who: Who, id: string) => Promise<boolean>;

/**
 * What is left of the former OpenFGA platform store: `can_access` on a
 * cluster (the gateway and federation ask it), answered by the ACL. Every
 * other check is `acl.can(privilege, path)`.
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

  private clusterPath = async (id: string) => {
    const name = (await this.acl.lookup()).clusterNames.get(id);
    return name ? `/clusters/${name}` : null;
  };

  private readonly relations: Record<string, Check> = {
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
