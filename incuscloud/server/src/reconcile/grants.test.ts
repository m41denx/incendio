import { describe, expect, test } from "bun:test";
import { aclGroup, desiredGrants, diffTuples, explicitRelations, groupName, isManaged } from "./grants.ts";
import { ROLES, type RoleId } from "../acl/catalog.ts";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const sorted = (ts: { user: string; relation: string; object: string }[]) => ts.map((t) => `${t.user} ${t.relation} ${t.object}`).sort();

test("group names", () => {
  expect(groupName("tenant", T1, "owner")).toBe(`incuscloud-tenant-${T1}-owner`);
  expect(groupName("platform", "admin")).toBe("incuscloud-platform-admin");
});

test("desired grants cover placed tenants and platform roles only", () => {
  const g = desiredGrants({
    placements: [{ tenantId: T1, project: "acme" }],
    members: [
      { tenantId: T1, subject: "u-owner", role: "owner" },
      { tenantId: T1, subject: "u-member", role: "member" },
      { tenantId: T1, subject: "sa-ci", role: "member" },
      { tenantId: T2, subject: "u-elsewhere", role: "admin" },
    ],
    platform: [
      { subject: "u-root", role: "admin" },
      { subject: "sa-ops", role: "viewer" },
    ],
  });
  const g1 = (role: string) => `group:${groupName("tenant", T1, role)}`;
  expect(sorted(g)).toEqual(
    sorted([
      { user: `${g1("owner")}#member`, relation: "operator", object: "project:acme" },
      { user: `${g1("admin")}#member`, relation: "operator", object: "project:acme" },
      { user: `${g1("member")}#member`, relation: "operator", object: "project:acme" },
      { user: `${g1("viewer")}#member`, relation: "viewer", object: "project:acme" },
      { user: "user:u-owner", relation: "member", object: g1("owner") },
      { user: "user:u-member", relation: "member", object: g1("member") },
      { user: "user:sa-ci", relation: "member", object: g1("member") },
      { user: "group:incuscloud-platform-admin#member", relation: "admin", object: "server:incus" },
      { user: "group:incuscloud-platform-operator#member", relation: "operator", object: "server:incus" },
      { user: "group:incuscloud-platform-viewer#member", relation: "viewer", object: "server:incus" },
      { user: "user:u-root", relation: "member", object: "group:incuscloud-platform-admin" },
      { user: "user:sa-ops", relation: "member", object: "group:incuscloud-platform-viewer" },
    ]),
  );
});

test("only IncusCloud's tuples are managed", () => {
  expect(isManaged({ user: "group:incuscloud-platform-admin#member", relation: "admin", object: "server:incus" })).toBe(true);
  expect(isManaged({ user: "user:u1", relation: "member", object: `group:incuscloud-tenant-${T1}-member` })).toBe(true);
  expect(isManaged({ user: "user:alice", relation: "admin", object: "project:acme" })).toBe(false);
  expect(isManaged({ user: "group:ops#member", relation: "operator", object: "project:acme" })).toBe(false);
  expect(isManaged({ user: "server:incus", relation: "server", object: "project:acme" })).toBe(false);
  expect(isManaged({ user: "user:*", relation: "authenticated", object: "server:incus" })).toBe(false);
});

test("diff writes what is missing and deletes only managed extras", () => {
  const keep = { user: "user:u1", relation: "member", object: "group:incuscloud-platform-admin" };
  const add = { user: "user:u2", relation: "member", object: "group:incuscloud-platform-admin" };
  const stale = { user: "user:gone", relation: "member", object: "group:incuscloud-platform-admin" };
  const foreign = { user: "user:alice", relation: "admin", object: "project:acme" };
  const d = diffTuples([keep, add], [keep, stale, foreign]);
  expect(d.writes).toEqual([add]);
  expect(d.deletes).toEqual([stale]);
});

test("no tenant role can edit its project (restricted, limits): never project admin", () => {
  const g = desiredGrants({ placements: [{ tenantId: T1, project: "acme" }], members: [], platform: [] });
  expect(g.filter((t) => t.object === "project:acme").map((t) => t.relation)).not.toContain("admin");
});

describe("explicitRelations", () => {
  const at = (m: Record<string, [RoleId[], string]>) => (p: string) => (m[p] ? { roles: m[p]![0], at: m[p]![1] } : { roles: [] as RoleId[] });
  test("an administrator on / is server admin and nothing more, though projects map to operator", () => {
    const d = at({ "/clusters/c": [["administrator"], "/"], "/clusters/c/projects/a": [["administrator"], "/"] });
    expect(explicitRelations("c", ["a"], d)).toEqual([{ relation: "admin", object: "server:incus" }]);
  });
  test("a project entry giving more than the cluster adds a project relation", () => {
    const d = at({ "/clusters/c": [["auditor"], "/clusters/c"], "/clusters/c/projects/a": [["operator"], "/clusters/c/projects/a"], "/clusters/c/projects/b": [["auditor"], "/clusters/c"] });
    expect(explicitRelations("c", ["a", "b"], d)).toEqual([{ relation: "viewer", object: "server:incus" }, { relation: "operator", object: "project:a" }]);
  });
  test("a project narrowed below the cluster replaces the server relation by the other projects'", () => {
    const d = at({ "/clusters/c": [["cluster-owner"], "/clusters/c"], "/clusters/c/projects/a": [["auditor"], "/tenants/t"], "/clusters/c/projects/b": [["cluster-owner"], "/clusters/c"] });
    expect(explicitRelations("c", ["a", "b"], d)).toEqual([{ relation: "viewer", object: "project:a" }, { relation: "operator", object: "project:b" }]);
  });
  test("acl groups are stable, distinct and IncusCloud's", () => {
    expect(aclGroup("viewer", "project:a")).toMatch(/^incuscloud-acl-[0-9a-f]{12}$/);
    expect(aclGroup("viewer", "project:a")).toBe(aclGroup("viewer", "project:a"));
    expect(aclGroup("viewer", "project:a")).not.toBe(aclGroup("operator", "project:a"));
    expect(isManaged({ user: "user:x", relation: "member", object: `group:${aclGroup("viewer", "project:a")}` })).toBe(true);
  });
});

test("explicitRelations: no access beside another role at the same level gives nothing", () => {
  const d = (p: string) => (p === "/clusters/c" ? { roles: ["operator", "no-access"] as RoleId[], at: "/clusters/c" } : { roles: [] as RoleId[] });
  expect(explicitRelations("c", [], d)).toEqual([]);
});

test("explicitRelations: Unrestricted user never maps to a server relation", () => {
  const d = (p: string) => (p === "/clusters/c" ? { roles: ["unrestricted-user"] as RoleId[], at: "/clusters/c" } : { roles: ["unrestricted-user"] as RoleId[], at: "/clusters/c" });
  expect(explicitRelations("c", ["a"], d)).toEqual([{ relation: "operator", object: "project:a" }]);
});

// Permissions phase 2: project and instance paths, and the User role.
describe("explicitRelations with instances", () => {
  const priv = (roles: RoleId[], owned: boolean) => new Set(roles.includes("no-access") ? [] : roles.flatMap((r) => [...ROLES[r].privileges, ...(owned ? [...(ROLES[r].ownedOnly ?? [])] : [])]));
  /** The most specific of `m` above a path decides it; `owned` instances add the role's owner-only privileges. */
  const decider = (m: Record<string, { roles: RoleId[]; at?: string }>, owned = new Set<string>()) => (path: string) => {
    const best = Object.keys(m).filter((k) => path === k || path.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
    const d = best ? m[best]! : { roles: [] as RoleId[] };
    return { roles: d.roles, at: best && (d.at ?? best), privileges: priv(d.roles, owned.has(path)) };
  };
  const I = "/clusters/c/projects/acme/instances";
  const acme = { name: "acme", instances: ["mine", "theirs"], shared: ["profile:acme/default", "network:default/incusbr0", "image:acme/abc"] };
  const set = (rs: Array<{ relation: string; object: string }>) => rs.map((r) => `${r.relation} ${r.object}`).sort();

  test("a User on /tenants/acme gets no project relation, only the direct entitlements and can_view on shared objects; operator on what they own", () => {
    const d = decider({ "/clusters/c/projects/acme": { roles: ["user"], at: "/tenants/acme" } }, new Set([`${I}/mine`]));
    expect(set(explicitRelations("c", [acme], d))).toEqual(
      set([
        ...["can_create_instances", "can_create_storage_volumes", "can_create_storage_buckets", "can_view_events", "can_view_operations"].map((relation) => ({ relation, object: "project:acme" })),
        ...acme.shared.map((object) => ({ relation: "can_view", object })),
        { relation: "operator", object: "instance:acme/mine" },
      ]),
    );
  });

  test("auditor on one instance gives viewer there only", () => {
    expect(explicitRelations("c", [acme], decider({ [`${I}/theirs`]: { roles: ["auditor"] } }))).toEqual([{ relation: "viewer", object: "instance:acme/theirs" }]);
  });

  test("No access on one instance of an operator's project replaces the project relation by the other instances'", () => {
    const d = decider({ "/clusters/c": { roles: ["operator"] }, [`${I}/theirs`]: { roles: ["no-access"] } });
    const b = { name: "b", instances: ["x"], shared: [] };
    expect(set(explicitRelations("c", [acme, b], d))).toEqual(set([{ relation: "operator", object: "project:b" }, { relation: "operator", object: "instance:acme/mine" }]));
  });

  test("an Operator entry on an instance under an Auditor project adds operator there", () => {
    const d = decider({ "/clusters/c/projects/acme": { roles: ["auditor"] }, [`${I}/mine`]: { roles: ["operator"] } });
    expect(set(explicitRelations("c", [acme], d))).toEqual(set([{ relation: "viewer", object: "project:acme" }, { relation: "operator", object: "instance:acme/mine" }]));
  });

  test("projects given as names, without instance facts, keep phase 1's relations", () => {
    expect(explicitRelations("c", ["a"], decider({ "/clusters/c": { roles: ["operator"] } }))).toEqual([{ relation: "operator", object: "server:incus" }]);
  });
});
