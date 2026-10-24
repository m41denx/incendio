import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, clusterMembers, clusters, groupMembers, instanceOwners, instances, k8sClusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
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
  /** Owned objects' paths (instances, Kubernetes clusters) → owner subject. */
  owners: Map<string, string>;
  /** Every project path IncusCloud knows of (placements and the inventory). */
  projects: string[];
  /** A user's or service account's groups: `group:<id>` and its tenants' default groups `tenant:<id>`. */
  groupsOf: Map<string, string[]>;
  /** An instance path → the group paths (`/clusters/<c>/groups/<g>`) of the member it runs on: its second parent. */
  locatedIn: Map<string, string[]>;
  /** A group path → the instance paths on its members. */
  onGroup: Map<string, string[]>;
}

/** Which instances a subject may act on with one privilege: whole projects, minus and plus single instances (keys `<cluster>/<project>[/<name>]`). */
export interface InstanceScope {
  projects: string[];
  exclude: string[];
  include: string[];
}

/** Ids to names, for callers that hold ids (the `Authz` adapter). */
export interface Lookup {
  tenantSlugs: Map<string, string>;
  clusterNames: Map<string, string>;
  serviceAccounts: Set<string>;
  /** `<tenantId>:<userId>` of tenant owners. */
  owners: Set<string>;
}

interface DecideOpts {
  owner?: string;
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
    const [explicit, roles, members, accounts, people, places, allTenants, allClusters, owned, k8s, inventoried, grouped, memberGroups, located] = await Promise.all([
      db.select().from(aclEntries),
      db.select().from(platformRoles),
      db.select({ tenantId: tenantMembers.tenantId, userId: tenantMembers.userId, role: tenantMembers.role, slug: tenants.slug }).from(tenantMembers).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId)),
      db.select({ id: serviceAccounts.id, tenantId: serviceAccounts.tenantId, platformRole: serviceAccounts.platformRole, disabled: serviceAccounts.disabled, slug: tenants.slug }).from(serviceAccounts).leftJoin(tenants, eq(tenants.id, serviceAccounts.tenantId)),
      db.select({ id: users.id, disabled: users.disabled }).from(users),
      db.select({ cluster: clusters.name, project: placements.project, slug: tenants.slug }).from(placements).innerJoin(clusters, eq(clusters.id, placements.clusterId)).innerJoin(tenants, eq(tenants.id, placements.tenantId)),
      db.select({ id: tenants.id, slug: tenants.slug }).from(tenants),
      db.select({ id: clusters.id, name: clusters.name }).from(clusters),
      db.select({ cluster: clusters.name, project: instanceOwners.project, name: instanceOwners.name, userId: instanceOwners.userId, serviceAccountId: instanceOwners.serviceAccountId }).from(instanceOwners).innerJoin(clusters, eq(clusters.id, instanceOwners.clusterId)),
      db.select({ slug: tenants.slug, name: k8sClusters.name, createdBy: k8sClusters.createdBy }).from(k8sClusters).innerJoin(tenants, eq(tenants.id, k8sClusters.tenantId)),
      db.selectDistinct({ cluster: clusters.name, project: instances.project }).from(instances).innerJoin(clusters, eq(clusters.id, instances.clusterId)),
      db.select().from(groupMembers),
      db.select({ cluster: clusters.name, name: clusterMembers.name, groups: clusterMembers.groups }).from(clusterMembers).innerJoin(clusters, eq(clusters.id, clusterMembers.clusterId)),
      db.select({ cluster: clusters.name, project: instances.project, name: instances.name, location: instances.location }).from(instances).innerJoin(clusters, eq(clusters.id, instances.clusterId)),
    ]);
    const entries: Entry[] = [];
    for (const e of explicit)
      if (isRoleId(e.role)) entries.push({ id: e.id, path: e.path, subject: entrySubject(e), role: e.role, propagate: e.propagate, source: "acl" });
    for (const r of roles) if (PLATFORM_ROLE[r.role]) entries.push({ id: `platform-role:${r.userId}`, path: "/", subject: `user:${r.userId}`, role: PLATFORM_ROLE[r.role]!, propagate: true, source: "platform-role" });
    for (const m of members)
      if (TENANT_ROLE[m.role]) entries.push({ id: `tenant-membership:${m.tenantId}:${m.userId}`, path: `/tenants/${m.slug}`, subject: `user:${m.userId}`, role: TENANT_ROLE[m.role]!, propagate: true, source: "tenant-membership" });
    for (const a of accounts) {
      if (a.slug) entries.push({ id: `service-account:${a.id}`, path: `/tenants/${a.slug}`, subject: `service:${a.id}`, role: "unrestricted-user", propagate: true, source: "service-account" });
      else if (!a.tenantId && a.platformRole && PLATFORM_ROLE[a.platformRole]) entries.push({ id: `service-account:${a.id}`, path: "/", subject: `service:${a.id}`, role: PLATFORM_ROLE[a.platformRole]!, propagate: true, source: "service-account" });
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
    const owners = new Map<string, string>();
    for (const o of owned) {
      const subject = o.userId ? `user:${o.userId}` : o.serviceAccountId ? `service:${o.serviceAccountId}` : null;
      if (subject) owners.set(`/clusters/${o.cluster}/projects/${o.project}/instances/${o.name}`, subject);
    }
    for (const k of k8s) owners.set(`/tenants/${k.slug}/kubernetes/${k.name}`, k.createdBy);
    const projects = [...new Set([...places, ...inventoried].map((x) => `/clusters/${x.cluster}/projects/${x.project}`))];
    // Groups: IncusCloud's, and each tenant's default group (its members and service accounts, always).
    const groupsOf = new Map<string, string[]>();
    for (const g of grouped) push(groupsOf, g.userId ? `user:${g.userId}` : `service:${g.serviceAccountId}`, `group:${g.groupId}`);
    for (const m of members) push(groupsOf, `user:${m.userId}`, `tenant:${m.tenantId}`);
    for (const a of accounts) if (a.tenantId) push(groupsOf, `service:${a.id}`, `tenant:${a.tenantId}`);
    // Instances' second parent: the Incus cluster groups of the member they run on.
    const groupsAt = new Map(memberGroups.map((m) => [`${m.cluster}/${m.name}`, (m.groups ?? []).length ? m.groups! : ["default"]]));
    const locatedIn = new Map<string, string[]>();
    const onGroup = new Map<string, string[]>();
    for (const i of located) {
      const path = `/clusters/${i.cluster}/projects/${i.project}/instances/${i.name}`;
      const gs = (groupsAt.get(`${i.cluster}/${i.location}`) ?? []).map((g) => `/clusters/${i.cluster}/groups/${g}`);
      if (!gs.length) continue;
      locatedIn.set(path, gs);
      for (const g of gs) push(onGroup, g, path);
    }
    return { at, entries, byPath, bySubject, disabled, tenantOf, projectsOf, ids, owners, projects, groupsOf, locatedIn, onGroup };
  }

  /** `opts.owner`: the object's owner, for objects without a path of their own (backups); owned paths are looked up. */
  private decide(s: Snapshot, subject: string, path: string, opts: DecideOpts = {}) {
    const parsed = parsePath(path);
    if (!parsed || s.disabled.has(subject)) return { privileges: new Set<Privilege>(), decidedBy: [] as Entry[] };
    const owned = (opts.owner ?? s.owners.get(path)) === subject;
    const keys = this.keysOf(s, subject);
    const full = chain(parsed, (c, p) => s.tenantOf.get(`${c}/${p}`));
    const sides = parsed.kind === "instance" ? (s.locatedIn.get(path) ?? []) : [];
    if (!sides.length) return resolve(keys, s.byPath, full, owned);
    // An instance has two parents (spec "Resolution" 4): its project, and the groups of the member it runs on.
    // Its own entries decide alone; otherwise each side is resolved and the results are combined. A group side
    // counts only the group's own entries, so it never brings back what a tenant or project entry narrowed away.
    const own = resolve(keys, s.byPath, [path], owned);
    if (own.decidedBy.length) return own;
    const results = [resolve(keys, s.byPath, full, owned), ...sides.map((g) => resolve(keys, s.byPath, [path, g], owned))];
    const privileges = new Set<Privilege>();
    const decidedBy: Entry[] = [];
    for (const r of results) {
      for (const p of r.privileges) privileges.add(p);
      for (const e of r.decidedBy) if (!decidedBy.includes(e)) decidedBy.push(e);
    }
    return { privileges, decidedBy };
  }

  /** The subject and its groups: whose entries count for it. */
  private keysOf(s: Snapshot, subject: string): string[] {
    return [subject, ...(s.groupsOf.get(subject) ?? [])];
  }

  async privileges(p: Pick<Principal, "kind" | "id">, path: string, opts?: DecideOpts): Promise<Set<Privilege>> {
    return this.decide(await this.snapshot(), subjectOf(p), path, opts).privileges;
  }

  async can(p: Pick<Principal, "kind" | "id">, privilege: Privilege, path: string, opts?: DecideOpts): Promise<boolean> {
    return (await this.privileges(p, path, opts)).has(privilege);
  }

  /** The permission path of an instance on a cluster known by id; null for a cluster IncusCloud does not know. */
  async instancePath(clusterId: string, project: string, name: string): Promise<string | null> {
    const cluster = (await this.snapshot()).ids.clusterNames.get(clusterId);
    return cluster ? `/clusters/${cluster}/projects/${project}/instances/${name}` : null;
  }

  /**
   * Whether `p` holds `privilege` on an instance (by cluster id); a row `p` made (`createdBy`, a backup's) counts as
   * theirs too. A row whose cluster is gone (a backup outliving it) is decided on its tenant, else on /.
   */
  async canOnInstance(p: Pick<Principal, "kind" | "id">, privilege: Privilege, row: { clusterId: string | null; project: string; name: string; tenantId?: string | null; createdBy?: string | null }): Promise<boolean> {
    const slug = row.tenantId ? (await this.snapshot()).ids.tenantSlugs.get(row.tenantId) : undefined;
    const path = (row.clusterId && (await this.instancePath(row.clusterId, row.project, row.name))) || (slug ? `/tenants/${slug}` : "/");
    const mine = row.createdBy === subjectOf(p);
    return (await this.can(p, privilege, path)) || (mine && (await this.can(p, privilege, path, { owner: subjectOf(p) })));
  }

  /** The instances `p` holds `privilege` on, for filtering lists in SQL. */
  async instanceScope(p: Pick<Principal, "kind" | "id">, privilege: Privilege = "instance.view"): Promise<InstanceScope> {
    const s = await this.snapshot();
    const subject = subjectOf(p);
    const key = (path: string) => path.slice("/clusters/".length).replace("/projects/", "/").replace("/instances/", "/");
    const out: InstanceScope = { projects: [], exclude: [], include: [] };
    for (const path of s.projects) if (this.decide(s, subject, path).privileges.has(privilege)) out.projects.push(key(path));
    // Single instances: those with entries of the subject (or its groups), those on its groups' cluster groups, and those it owns.
    const singles = new Set<string>();
    for (const k of this.keysOf(s, subject))
      for (const e of s.bySubject.get(k) ?? []) {
        const kind = parsePath(e.path)?.kind;
        if (kind === "instance") singles.add(e.path);
        if (kind === "group") for (const i of s.onGroup.get(e.path) ?? []) singles.add(i);
      }
    for (const [path, owner] of s.owners) if (owner === subject && path.startsWith("/clusters/")) singles.add(path);
    const inProject = new Set(out.projects);
    for (const path of singles) {
      const k = key(path);
      const has = this.decide(s, subject, path).privileges.has(privilege);
      const covered = inProject.has(k.slice(0, k.lastIndexOf("/")));
      if (has && !covered) out.include.push(k);
      if (!has && covered) out.exclude.push(k);
    }
    return out;
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
    for (const e of this.keysOf(s, subject).flatMap((k) => s.bySubject.get(k) ?? [])) {
      const at = [e.path];
      const t = /^\/tenants\/([^/]+)$/.exec(e.path)?.[1];
      if (t) at.push(...(s.projectsOf.get(t) ?? []));
      // A cluster group reaches the instances on its members.
      at.push(...(s.onGroup.get(e.path) ?? []));
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

/** An explicit entry's subject key: a user, a service account, a group, or a tenant's default group. */
export const entrySubject = (e: { userId: string | null; serviceAccountId: string | null; groupId: string | null; tenantGroupId: string | null }) =>
  e.userId ? `user:${e.userId}` : e.serviceAccountId ? `service:${e.serviceAccountId}` : e.groupId ? `group:${e.groupId}` : `tenant:${e.tenantGroupId}`;
