import type { Authz, Tuple } from "./platform.ts";

/**
 * An in-memory evaluator of authz/model.fga for tests. Kept honest by
 * fake.it.test.ts, which compares it with a real OpenFGA on every relation.
 */
export class FakeAuthz implements Authz {
  private tuples = new Set<string>();
  private key = (t: Tuple) => `${t.user}|${t.relation}|${t.object}`;
  private has = (user: string, relation: string, object: string) => this.tuples.has(`${user}|${relation}|${object}`);
  /** Subjects with `relation` on `object` that are of `type` (tupleset lookups). */
  private subjects(relation: string, object: string, type: string) {
    return [...this.tuples].map((k) => k.split("|") as [string, string, string]).filter(([u, r, o]) => r === relation && o === object && u.startsWith(`${type}:`)).map(([u]) => u);
  }
  private any = async (xs: string[], f: (x: string) => Promise<boolean>) => {
    for (const x of xs) if (await f(x)) return true;
    return false;
  };

  all(): Tuple[] {
    return [...this.tuples].map((k) => {
      const [user, relation, object] = k.split("|") as [string, string, string];
      return { user, relation, object };
    });
  }

  async write(writes: Tuple[], deletes: Tuple[] = []) {
    for (const t of writes) this.tuples.add(this.key(t));
    for (const t of deletes) this.tuples.delete(this.key(t));
  }

  async check(user: string, relation: string, object: string): Promise<boolean> {
    const type = object.split(":")[0];
    const d = this.has(user, relation, object);
    const fromPlatform = (rel: string) => this.any(this.subjects("platform", object, "platform"), (p) => this.check(user, rel, p));
    switch (`${type}#${relation}`) {
      case "platform#admin":
        return d;
      case "platform#operator":
        return d || this.check(user, "admin", object);
      case "platform#viewer":
        return d || this.check(user, "operator", object);
      case "tenant#owner":
        return d;
      case "tenant#admin":
        return d || (await this.check(user, "owner", object)) || fromPlatform("admin");
      case "tenant#member":
        return d || this.check(user, "admin", object);
      case "tenant#viewer":
        return d || (await this.check(user, "member", object)) || fromPlatform("viewer");
      case "cluster#admin":
        return fromPlatform("admin");
      case "cluster#viewer":
        return d || (await this.check(user, "admin", object)) || fromPlatform("viewer");
      case "cluster#can_access":
        return (await this.check(user, "viewer", object)) || this.any(this.subjects("tenant", object, "tenant"), (t) => this.check(user, "member", t));
      default:
        return d;
    }
  }

  async listObjects(user: string, relation: string, type: string): Promise<string[]> {
    const objects = new Set(this.all().map((t) => t.object).filter((o) => o.startsWith(`${type}:`)));
    const out: string[] = [];
    for (const o of objects) if (await this.check(user, relation, o)) out.push(o);
    return out.sort();
  }
}
