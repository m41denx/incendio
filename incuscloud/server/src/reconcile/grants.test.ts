import { expect, test } from "bun:test";
import { desiredGrants, diffTuples, groupName, isManaged } from "./grants.ts";

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
      { user: `${g1("owner")}#member`, relation: "admin", object: "project:acme" },
      { user: `${g1("admin")}#member`, relation: "admin", object: "project:acme" },
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
