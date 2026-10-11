import type { Tuple } from "../authz/platform.ts";

export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type PlatformRole = "admin" | "operator" | "viewer";

const PREFIX = "incuscloud-";

/** Incus groups IncusCloud owns in each cluster store. */
export function groupName(kind: "tenant", tenantId: string, role: TenantRole | string): string;
export function groupName(kind: "platform", role: PlatformRole | string): string;
export function groupName(kind: "tenant" | "platform", a: string, b?: string): string {
  return kind === "tenant" ? `${PREFIX}tenant-${a}-${b}` : `${PREFIX}platform-${a}`;
}

/** Tenant role → Incus project relation (spec D5). */
const PROJECT_RELATION: Record<TenantRole, string> = { owner: "admin", admin: "admin", member: "operator", viewer: "viewer" };
const TENANT_ROLES = Object.keys(PROJECT_RELATION) as TenantRole[];
const PLATFORM_ROLES: PlatformRole[] = ["admin", "operator", "viewer"];

export interface GrantFacts {
  /** Tenants placed on this cluster and their project. */
  placements: Array<{ tenantId: string; project: string }>;
  /** Tenant members (users and service accounts); `subject` is the Incus user name (the token's `sub`). */
  members: Array<{ tenantId: string; subject: string; role: string }>;
  platform: Array<{ subject: string; role: string }>;
}

/** The grant tuples a cluster store should hold for IncusCloud. */
export function desiredGrants(f: GrantFacts): Tuple[] {
  const out: Tuple[] = [];
  const placed = new Set<string>();
  for (const p of f.placements) {
    placed.add(p.tenantId);
    for (const role of TENANT_ROLES) {
      out.push({ user: `group:${groupName("tenant", p.tenantId, role)}#member`, relation: PROJECT_RELATION[role], object: `project:${p.project}` });
    }
  }
  for (const m of f.members) {
    if (placed.has(m.tenantId) && m.role in PROJECT_RELATION) out.push({ user: `user:${m.subject}`, relation: "member", object: `group:${groupName("tenant", m.tenantId, m.role)}` });
  }
  for (const role of PLATFORM_ROLES) out.push({ user: `group:${groupName("platform", role)}#member`, relation: role, object: "server:incus" });
  for (const p of f.platform) {
    if ((PLATFORM_ROLES as string[]).includes(p.role)) out.push({ user: `user:${p.subject}`, relation: "member", object: `group:${groupName("platform", p.role)}` });
  }
  return out;
}

/** Tuples IncusCloud wrote: anything granting to, or naming, one of its groups. */
export const isManaged = (t: Tuple) => t.user.startsWith(`group:${PREFIX}`) || t.object.startsWith(`group:${PREFIX}`);

const key = (t: Tuple) => `${t.user}|${t.relation}|${t.object}`;

/** What to write and delete to reach `desired`; never deletes tuples IncusCloud does not own. */
export function diffTuples(desired: Tuple[], current: Tuple[]): { writes: Tuple[]; deletes: Tuple[] } {
  const want = new Map(desired.map((t) => [key(t), t]));
  const have = new Map(current.map((t) => [key(t), t]));
  return {
    writes: [...want].filter(([k]) => !have.has(k)).map(([, t]) => t),
    deletes: [...have].filter(([k, t]) => !want.has(k) && isManaged(t)).map(([, t]) => t),
  };
}
