import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import type { Principal } from "../auth/principal.ts";
import { isRoleId, type Privilege, type RoleId } from "./catalog.ts";
import { chain, parsePath } from "./paths.ts";
import { resolve, type Entry } from "./resolve.ts";

/** Today's roles, read as entries (spec "Migration"). */
const PLATFORM_ROLE: Record<string, RoleId> = { admin: "administrator", operator: "operator", viewer: "auditor" };
const TENANT_ROLE: Record<string, RoleId> = { owner: "tenant-admin", admin: "tenant-admin", member: "unrestricted-user", viewer: "auditor" };

export const subjectOf = (p: Pick<Principal, "kind" | "id">) => `${p.kind === "service" ? "service" : "user"}:${p.id}`;

interface Snapshot {
  at: number;
  entries: Entry[];
  byPath: Map<string, Entry[]>;
  bySubject: Map<string, Entry[]>;
  disabled: Set<string>;
  /** `<cluster>/<project>` → tenant slug, for the tenants' projects. */
  tenantOf: Map<string, string>;
  /** Tenant slug → its project paths (`/clusters/<c>/projects/<p>`). */
  projectsOf: Map<string, string[]>;
  ids: Lookup;
}

/** Ids to names, for callers that hold ids (the `Authz` adapter). */
export interface Lookup {
  tenantSlugs: Map<string, string>;
  clusterNames: Map<string, string>;
  serviceAccounts: Set<string>;
  /** `<tenantId>:<userId>` of tenant owners. */
  owners: Set<string>;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);

/**
 * Who may do what where: Proxmox-style resolution over explicit entries
 * (`acl_entries`) and today's role tables. Reads a snapshot that lives
 * `ttlMs` (other replicas' changes arrive within it) and is dropped by
 * `invalidate()` after a change made here.
 */
export class Acl {
  private snap?: Promise<Snapshot>;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 2000;
    this.now = opts.now ?? Date.now;
  }

  invalidate(): void {
    this.snap = undefined;
  }

  private async snapshot(): Promise<Snapshot> {
    // A failed load is not kept: the next call loads again.
    const cur = this.snap && (await this.snap.catch(() => undefined));
    if (cur && this.now() - cur.at < this.ttlMs) return cur;
    const next = this.load();
    this.snap = next;
    next.catch(() => {
      if (this.snap === next) this.snap = undefined;
    });
    return next;
  }

  private async load(): Promise<Snapshot> {
    const at = this.now();
    const db = this.db;
    const [explicit, roles, members, accounts, people, places, allTenants, allClusters] = await Promise.all([
      db.select().from(aclEntries),
      db.select().from(platformRoles),
      db.select({ tenantId: tenantMembers.tenantId, userId: tenantMembers.userId, role: tenantMembers.role, slug: tenants.slug }).from(tenantMembers).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId)),
      db.select({ id: serviceAccounts.id, tenantId: serviceAccounts.tenantId, platformRole: serviceAccounts.platformRole, disabled: serviceAccounts.disabled, slug: tenants.slug }).from(serviceAccounts).leftJoin(tenants, eq(tenants.id, serviceAccounts.tenantId)),
      db.select({ id: users.id, disabled: users.disabled }).from(users),
      db.select({ cluster: clusters.name, project: placements.project, slug: tenants.slug }).from(placements).innerJoin(clusters, eq(clusters.id, placements.clusterId)).innerJoin(tenants, eq(tenants.id, placements.tenantId)),
      db.select({ id: tenants.id, slug: tenants.slug }).from(tenants),
      db.select({ id: clusters.id, name: clusters.name }).from(clusters),
    ]);
    const entries: Entry[] = [];
    for (const e of explicit)
      if (isRoleId(e.role)) entries.push({ id: e.id, path: e.path, subject: e.userId ? `user:${e.userId}` : `service:${e.serviceAccountId}`, role: e.role, propagate: e.propagate, source: "acl" });
    for (const r of roles) if (PLATFORM_ROLE[r.role]) entries.push({ id: `platform-role:${r.userId}`, path: "/", subject: `user:${r.userId}`, role: PLATFORM_ROLE[r.role]!, propagate: true, source: "platform-role" });
    for (const m of members)
      if (TENANT_ROLE[m.role]) entries.push({ id: `tenant-membership:${m.tenantId}:${m.userId}`, path: `/tenants/${m.slug}`, subject: `user:${m.userId}`, role: TENANT_ROLE[m.role]!, propagate: true, source: "tenant-membership" });
    for (const a of accounts) {
      if (a.slug) entries.push({ id: `service-account:${a.id}`, path: `/tenants/${a.slug}`, subject: `service:${a.id}`, role: "unrestricted-user", propagate: true, source: "service-account" });
      else if (a.platformRole && PLATFORM_ROLE[a.platformRole]) entries.push({ id: `service-account:${a.id}`, path: "/", subject: `service:${a.id}`, role: PLATFORM_ROLE[a.platformRole]!, propagate: true, source: "service-account" });
    }
    const byPath = new Map<string, Entry[]>();
    const bySubject = new Map<string, Entry[]>();
    for (const e of entries) {
      push(byPath, e.path, e);
      push(bySubject, e.subject, e);
    }
    const disabled = new Set([...people.filter((u) => u.disabled).map((u) => `user:${u.id}`), ...accounts.filter((a) => a.disabled).map((a) => `service:${a.id}`)]);
    const tenantOf = new Map<string, string>();
    const projectsOf = new Map<string, string[]>();
    for (const p of places) {
      tenantOf.set(`${p.cluster}/${p.project}`, p.slug);
      push(projectsOf, p.slug, `/clusters/${p.cluster}/projects/${p.project}`);
    }
    const ids: Lookup = {
      tenantSlugs: new Map(allTenants.map((t) => [t.id, t.slug])),
      clusterNames: new Map(allClusters.map((c) => [c.id, c.name])),
      serviceAccounts: new Set(accounts.map((a) => a.id)),
      owners: new Set(members.filter((m) => m.role === "owner").map((m) => `${m.tenantId}:${m.userId}`)),
    };
    return { at, entries, byPath, bySubject, disabled, tenantOf, projectsOf, ids };
  }

  private decide(s: Snapshot, subject: string, path: string) {
    const parsed = parsePath(path);
    if (!parsed || s.disabled.has(subject)) return { privileges: new Set<Privilege>(), decidedBy: [] as Entry[] };
    return resolve([subject], s.byPath, chain(parsed, (c, p) => s.tenantOf.get(`${c}/${p}`)));
  }

  async privileges(p: Pick<Principal, "kind" | "id">, path: string): Promise<Set<Privilege>> {
    return this.decide(await this.snapshot(), subjectOf(p), path).privileges;
  }

  async can(p: Pick<Principal, "kind" | "id">, privilege: Privilege, path: string): Promise<boolean> {
    return (await this.privileges(p, path)).has(privilege);
  }

  /** What a subject holds at `path` or on any path above it: what a change at `path` must not reach past. */
  async reach(subject: string, path: string): Promise<Set<Privilege>> {
    const s = await this.snapshot();
    const parsed = parsePath(path);
    const out = new Set<Privilege>();
    if (!parsed) return out;
    for (const x of chain(parsed, (c, p) => s.tenantOf.get(`${c}/${p}`))) for (const p of this.decide(s, subject, x).privileges) out.add(p);
    return out;
  }

  async explain(subject: string, path: string): Promise<{ privileges: Privilege[]; decidedBy: Entry[] }> {
    const r = this.decide(await this.snapshot(), subject, path);
    return { privileges: [...r.privileges].sort(), decidedBy: r.decidedBy };
  }

  /**
   * Whether the subject may see `path`: some privilege there, or below it
   * where one of its entries applies (someone with rights on an instance
   * sees its project and cluster). A tenant entry reaches the tenant's
   * projects, so the clusters the tenant is placed on.
   */
  async sees(p: Pick<Principal, "kind" | "id">, path: string): Promise<boolean> {
    const s = await this.snapshot();
    const subject = subjectOf(p);
    if (this.decide(s, subject, path).privileges.size) return true;
    const below = (x: string) => path === "/" || x.startsWith(`${path}/`);
    const candidates = new Set<string>();
    for (const e of s.bySubject.get(subject) ?? []) {
      const at = [e.path];
      const t = /^\/tenants\/([^/]+)$/.exec(e.path)?.[1];
      if (t) at.push(...(s.projectsOf.get(t) ?? []));
      for (const x of at) if (below(x)) candidates.add(x);
    }
    for (const x of candidates) if (this.decide(s, subject, x).privileges.size) return true;
    return false;
  }

  async lookup(): Promise<Lookup & { disabled: Set<string> }> {
    const s = await this.snapshot();
    return { ...s.ids, disabled: s.disabled };
  }

  /** Every entry, explicit and virtual. */
  async entries(): Promise<Entry[]> {
    return (await this.snapshot()).entries;
  }
}
