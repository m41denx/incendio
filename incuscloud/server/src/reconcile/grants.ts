import { createHash } from "node:crypto";
import type { Tuple } from "../authz/platform.ts";
import type { Privilege, RoleId } from "../acl/catalog.ts";

export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type PlatformRole = "admin" | "operator" | "viewer";

const PREFIX = "incuscloud-";

/** Incus groups IncusCloud owns in each cluster store. */
export function groupName(kind: "tenant", tenantId: string, role: TenantRole | string): string;
export function groupName(kind: "platform", role: PlatformRole | string): string;
export function groupName(kind: "tenant" | "platform", a: string, b?: string): string {
  return kind === "tenant" ? `${PREFIX}tenant-${a}-${b}` : `${PREFIX}platform-${a}`;
}

/**
 * Tenant role → Incus project relation (spec D5). Never `admin`: in Incus a project admin can edit
 * the project itself (`restricted`, `limits.*`), i.e. lift its own restrictions and get root on the
 * cluster. `operator` manages everything inside the project. Owner/admin differ on the platform only.
 */
const PROJECT_RELATION: Record<TenantRole, string> = { owner: "operator", admin: "operator", member: "operator", viewer: "viewer" };
const TENANT_ROLES = Object.keys(PROJECT_RELATION) as TenantRole[];

/** The Incus relation a tenant role gives on the tenant's project ("" for none). */
export const projectRelation = (role: string): string => PROJECT_RELATION[role as TenantRole] ?? "";
/** The Incus relation a platform role gives on the server ("" for none). */
export const serverRelation = (role: string): string => ((PLATFORM_ROLES as string[]).includes(role) ? role : "");
const PLATFORM_ROLES: PlatformRole[] = ["admin", "operator", "viewer"];

export interface GrantFacts {
  /** Tenants placed on this cluster and their project. */
  placements: Array<{ tenantId: string; project: string }>;
  /** Tenant members (users and service accounts); `subject` is the Incus user name (the token's `sub`). */
  members: Array<{ tenantId: string; subject: string; role: string }>;
  platform: Array<{ subject: string; role: string }>;
  /** Subjects with explicit permission entries: their relations here, from `explicitRelations`. */
  acl?: Array<{ subject: string; relation: string; object: string }>;
}

/** The group holding one relation for explicit permission entries. */
export const aclGroup = (relation: string, object: string) => `${PREFIX}acl-${createHash("sha256").update(`${relation}|${object}`).digest("hex").slice(0, 12)}`;

const RANK: Record<string, number> = { "": 0, viewer: 1, operator: 2, admin: 3 };
// Never Unrestricted user: Incus's server operator is operator on every project, the unrestricted default included.
const SERVER: Partial<Record<RoleId, string>> = { administrator: "admin", "cluster-owner": "admin", operator: "operator", auditor: "viewer" };
// Never project admin (see PROJECT_RELATION).
const PROJECT: Partial<Record<RoleId, string>> = { administrator: "operator", "cluster-owner": "operator", operator: "operator", "unrestricted-user": "operator", "tenant-admin": "operator", auditor: "viewer" };
/** What one role gives in Incus, on the server or on a project ("" for nothing); narrowing aside (see explicitRelations). */
export const roleRelation = (role: RoleId, on: "server" | "project") => strongest(on === "server" ? SERVER : PROJECT, [role]);
const strongest = (map: Partial<Record<RoleId, string>>, roles: RoleId[]) => (roles.includes("no-access") ? [] : roles).map((r) => map[r] ?? "").reduce((a, b) => (RANK[b]! > RANK[a]! ? b : a), "");

/** A project on the cluster, with its instances and the objects a User may need to see there (`profile:…`, `network:…`, `image:…`). */
export interface ProjectFacts {
  name: string;
  instances: string[];
  shared: string[];
}
/** A subject's resolution on one path: the deciding roles, the path they are on, and the privileges (ownership counted). */
export interface Decision {
  roles: RoleId[];
  at?: string;
  privileges?: ReadonlySet<Privilege>;
}

/** What a User needs on a project to create there, without seeing anyone's instances (spec decision 5). */
const USER_PROJECT = ["can_create_instances", "can_create_storage_volumes", "can_create_storage_buckets", "can_view_events", "can_view_operations"];

/** The instance relation privileges give: operator to configure it, user for its console, viewer to see it. */
const instanceRelation = (p: ReadonlySet<Privilege>) => (p.has("instance.configure") ? "operator" : p.has("instance.console") ? "user" : p.has("instance.view") ? "viewer" : "");
const IRANK: Record<string, number> = { "": 0, viewer: 1, user: 2, operator: 3 };
/** A project relation read as an instance one, for comparing the two. */
const asInstance = (projectRelation: string) => (projectRelation === "admin" ? "operator" : projectRelation);

/**
 * The Incus relations a subject's permissions give on one cluster. `decide(path)`
 * is the subject's resolution there. The server relation comes from the
 * cluster's decision. A project decided below the cluster (on the project or
 * its tenant) adds a project relation when it gives more; when it gives less,
 * the server relation would leak past it, so the subject gets project relations
 * on each project instead. Instances work the same way one level down: one
 * that gives more than its project adds an instance relation; one that gives
 * less replaces its project's relation by relations on its other instances.
 * A User (instance.create on the project but no project relation) gets the
 * project's direct entitlements and can_view on its shared objects, so it
 * creates there and sees only the instances it holds rights on.
 */
export function explicitRelations(cluster: string, projects: Array<string | ProjectFacts>, decide: (path: string) => Decision): Array<{ relation: string; object: string }> {
  const top = decide(`/clusters/${cluster}`).roles;
  const server = strongest(SERVER, top);
  const base = strongest(PROJECT, top);
  const per = projects.map((x) => {
    const f = typeof x === "string" ? { name: x, instances: [], shared: [] } : x;
    const path = `/clusters/${cluster}/projects/${f.name}`;
    const d = decide(path);
    const below = !!d.at && d.at !== "/" && d.at !== `/clusters/${cluster}`;
    const relation = below ? strongest(PROJECT, d.roles) : base;
    const instances = f.instances.map((name) => ({ name, relation: instanceRelation(decide(`${path}/instances/${name}`).privileges ?? new Set()) }));
    const narrowed = instances.some((i) => IRANK[i.relation]! < IRANK[asInstance(relation)]!);
    const user = !relation && !!d.privileges?.has("instance.create");
    return { f, relation: narrowed ? "" : relation, narrowed, instances, user };
  });
  const narrowed = per.some((x) => x.narrowed || RANK[x.relation]! < RANK[base]!);
  // Without a server relation (none, or narrowed away) every project's relation is its own grant.
  const whole = !narrowed && !!server;
  const out = whole ? [{ relation: server, object: "server:incus" }] : [];
  for (const x of per) {
    const p = x.f.name;
    if (x.relation && (!whole || RANK[x.relation]! > RANK[base]!)) out.push({ relation: x.relation, object: `project:${p}` });
    if (x.user) {
      for (const relation of USER_PROJECT) out.push({ relation, object: `project:${p}` });
      for (const object of x.f.shared) out.push({ relation: "can_view", object });
    }
    // What the project relation already gives (none when narrowed) needs no instance relation.
    const given = x.narrowed ? "" : asInstance(x.relation || (whole ? base : ""));
    for (const i of x.instances) if (IRANK[i.relation]! > IRANK[given]!) out.push({ relation: i.relation, object: `instance:${p}/${i.name}` });
  }
  return out;
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
  const defined = new Set<string>();
  for (const a of f.acl ?? []) {
    const group = aclGroup(a.relation, a.object);
    if (!defined.has(group)) out.push({ user: `group:${group}#member`, relation: a.relation, object: a.object });
    defined.add(group);
    out.push({ user: `user:${a.subject}`, relation: "member", object: `group:${group}` });
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
