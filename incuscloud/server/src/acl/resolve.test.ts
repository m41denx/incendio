import { describe, expect, test } from "bun:test";
import { PRIVILEGES, ROLES, type Privilege } from "./catalog.ts";
import { resolve, type Entry } from "./resolve.ts";

let n = 0;
const entry = (path: string, subject: string, role: Entry["role"], propagate = true): Entry => ({ id: `e${++n}`, path, subject, role, propagate, source: "acl" });
const byPath = (...es: Entry[]) => {
  const m = new Map<string, Entry[]>();
  for (const e of es) m.set(e.path, [...(m.get(e.path) ?? []), e]);
  return m;
};
const INSTANCE = ["/clusters/c/projects/acme/instances/web", "/clusters/c/projects/acme", "/tenants/acme", "/clusters/c", "/"];
const me = ["user:me"];

describe("resolution", () => {
  test("no access at the deciding level means nothing, whatever else is there", () => {
    const r = resolve(me, byPath(entry("/tenants/acme", "user:me", "unrestricted-user"), entry("/tenants/acme", "user:me", "no-access")), INSTANCE);
    expect(r.privileges).toEqual(new Set());
    expect(r.decidedBy.map((e) => e.role).sort()).toEqual(["no-access", "unrestricted-user"]);
  });

  test("an entry on / reaches everything below when it propagates", () => {
    expect(resolve(me, byPath(entry("/", "user:me", "operator")), INSTANCE).privileges).toEqual(new Set(ROLES.operator.privileges));
  });

  test("propagate false applies to its own path only", () => {
    const es = byPath(entry("/", "user:me", "operator", false));
    expect(resolve(me, es, INSTANCE).privileges.size).toBe(0);
    expect(resolve(me, es, ["/"]).privileges).toEqual(new Set(ROLES.operator.privileges));
  });

  test("the most specific path with an entry wins: auditor on the tenant narrows operator on /", () => {
    const r = resolve(me, byPath(entry("/", "user:me", "operator"), entry("/tenants/acme", "user:me", "auditor")), INSTANCE);
    expect(r.privileges).toEqual(new Set(ROLES.auditor.privileges));
    expect(r.privileges.has("instance.power")).toBe(false);
  });

  test("no-access gives nothing even under administrator", () => {
    expect(resolve(me, byPath(entry("/", "user:me", "administrator"), entry("/clusters/c", "user:me", "no-access")), INSTANCE).privileges.size).toBe(0);
  });

  test("at one path, the subject's entries are all combined (union of roles)", () => {
    const r = resolve(me, byPath(entry("/clusters/c", "user:me", "auditor"), entry("/clusters/c", "user:me", "unrestricted-user")), ["/clusters/c", "/"]);
    expect(r.privileges.has("instance.power")).toBe(true);
    expect(r.privileges.has("platform.audit")).toBe(true);
  });

  test("entries of other subjects never count", () => {
    expect(resolve(me, byPath(entry("/", "user:other", "administrator")), INSTANCE).privileges.size).toBe(0);
  });

  test("a subject with several keys (e.g. a user and its groups) matches each", () => {
    expect(resolve(["user:me", "group:ops"], byPath(entry("/clusters/c", "group:ops", "auditor")), INSTANCE).privileges).toEqual(new Set(ROLES.auditor.privileges));
  });

  test("at one path, the subject's own entries beat its groups' entries", () => {
    const es = byPath(entry("/clusters/c", "user:me", "auditor"), entry("/clusters/c", "group:ops", "operator"));
    expect(resolve(["user:me", "group:ops"], es, INSTANCE).privileges).toEqual(new Set(ROLES.auditor.privileges));
  });

  test("decidedBy names the entries of the deciding level", () => {
    const a = entry("/", "user:me", "operator");
    const b = entry("/tenants/acme", "user:me", "auditor");
    expect(resolve(me, byPath(a, b), INSTANCE).decidedBy).toEqual([b]);
    expect(resolve(me, byPath(a), ["/clusters/c", "/"]).decidedBy).toEqual([a]);
    expect(resolve(me, byPath(), INSTANCE).decidedBy).toEqual([]);
  });
});

describe("roles", () => {
  const all = new Set<Privilege>(PRIVILEGES);
  const without = (role: keyof typeof ROLES) => [...all].filter((p) => !ROLES[role].privileges.has(p)).sort();

  test("administrator holds every privilege; no-access none", () => {
    expect(without("administrator")).toEqual([]);
    expect(ROLES["no-access"].privileges.size).toBe(0);
  });

  test("operator lacks exactly the permissions and global settings privileges", () => {
    expect(without("operator")).toEqual(["acl.manage", "platform.settings", "platform.users"]);
  });

  test("unrestricted user never touches nodes, cluster settings, permissions or the platform", () => {
    for (const p of ROLES["unrestricted-user"].privileges) expect(p).not.toMatch(/^(node|acl|platform)\.|^cluster\.configure$/);
    expect(ROLES["unrestricted-user"].privileges.has("instance.create")).toBe(true);
    expect(ROLES["unrestricted-user"].privileges.has("placement.choose")).toBe(true);
  });

  test("cluster owner provisions nodes; group owner only maintains them", () => {
    expect(ROLES["cluster-owner"].privileges.has("node.provision")).toBe(true);
    expect(ROLES["cluster-owner"].privileges.has("acl.manage")).toBe(true);
    expect(ROLES["group-owner"].privileges.has("node.maintain")).toBe(true);
    expect(ROLES["group-owner"].privileges.has("node.provision")).toBe(false);
  });

  test("auditor is every *.view, acl.view and platform.audit", () => {
    const expected = [...all].filter((p) => p.endsWith(".view") || p === "platform.audit").sort();
    expect([...ROLES.auditor.privileges].sort()).toEqual(expected);
    expect(expected).toContain("acl.view");
  });

  test("tenant admin manages its tenant but never nodes or the platform", () => {
    const t = ROLES["tenant-admin"].privileges;
    for (const p of ["tenant.members", "tenant.quota", "acl.manage", "instance.create", "backup.create", "k8s.delete"] as Privilege[]) expect(t.has(p)).toBe(true);
    for (const p of t) expect(p).not.toMatch(/^(node|platform)\.|^cluster\.configure$/);
  });

  test("the user role holds its owned-only privileges only on what it owns", () => {
    const u = ROLES.user;
    expect(u.privileges.has("instance.create")).toBe(true);
    expect(u.ownedOnly?.has("instance.delete")).toBe(true);
    expect(u.privileges.has("instance.delete")).toBe(false);
  });
});
