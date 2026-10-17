import { Elysia, t } from "elysia";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import type { Acl } from "../acl/acl.ts";
import { notFound, subject } from "../authz/guards.ts";
import { authed, principalContext } from "../auth/principal.ts";
import { instanceRelation, projectRelation, roleRelation, serverRelation } from "../reconcile/grants.ts";
import { ROLES } from "../acl/catalog.ts";
import { filterAsync } from "./common.ts";

interface Holder {
  id: string;
  kind: "user" | "service-account";
  name: string;
  email?: string;
  role: string;
  /** What the role gives in Incus: on the server (platform) or the tenant's project. */
  relation: string;
}

const byName = (a: Holder, b: Holder) => a.name.localeCompare(b.name);

/**
 * Who has access to a cluster (or one project on it), and what it gives in
 * Incus: the same facts and role → relation maps the reconciler grants
 * from. Platform roles are shown to platform viewers; tenants to whoever
 * may see them.
 */
export function accessRoutes({ db, authz, acl }: { db: Db; authz: Authz; acl: Acl }) {
  return new Elysia().use(principalContext).get(
    "/api/v1/access",
    async ({ principal, query }) => {
      const p = authed(principal);
      const [cluster] = await db.select({ id: clusters.id, name: clusters.name }).from(clusters).where(eq(clusters.name, query.cluster));
      if (!cluster || !(await authz.check(subject(p), "can_access", `cluster:${cluster.id}`))) throw notFound("No such cluster");

      const placed = await db
        .select({ tenantId: tenants.id, slug: tenants.slug, name: tenants.name, project: placements.project, status: placements.status })
        .from(placements)
        .innerJoin(tenants, eq(tenants.id, placements.tenantId))
        .where(and(eq(placements.clusterId, cluster.id), query.project ? eq(placements.project, query.project) : undefined))
        .orderBy(tenants.slug);
      const shown = await filterAsync(placed, (x) => acl.can(p, "tenant.view", `/tenants/${x.slug}`));
      const ids = shown.map((x) => x.tenantId);
      const people = ids.length
        ? await db
            .select({ tenantId: tenantMembers.tenantId, id: users.id, name: users.name, email: users.email, role: tenantMembers.role })
            .from(tenantMembers)
            .innerJoin(users, eq(users.id, tenantMembers.userId))
            .where(and(inArray(tenantMembers.tenantId, ids), eq(users.disabled, false)))
        : [];
      const accounts = ids.length
        ? await db
            .select({ tenantId: serviceAccounts.tenantId, id: serviceAccounts.id, name: serviceAccounts.name })
            .from(serviceAccounts)
            .where(and(inArray(serviceAccounts.tenantId, ids), eq(serviceAccounts.disabled, false)))
        : [];

      const tenantList = shown.map((x) => ({
        tenant: { id: x.tenantId, slug: x.slug, name: x.name },
        project: x.project,
        status: x.status,
        members: [
          ...people.filter((m) => m.tenantId === x.tenantId).map((m): Holder => ({ id: m.id, kind: "user", name: m.name, email: m.email, role: m.role, relation: projectRelation(m.role) })),
          // Service accounts act as members (the reconciler grants them so).
          ...accounts.filter((a) => a.tenantId === x.tenantId).map((a): Holder => ({ id: a.id, kind: "service-account", name: a.name, role: "member", relation: projectRelation("member") })),
        ].sort(byName),
      }));

      // Permission entries that reach this cluster (or project), as far as the caller may read them.
      const where = new Map<string, string>([["/", "server"], [`/clusters/${cluster.name}`, "server"], ...shown.map((x) => [`/tenants/${x.slug}`, `project ${x.project}`] as [string, string])]);
      const named = new Map<string, string>([
        ...(await db.select({ id: users.id, email: users.email }).from(users)).map((u) => [`user:${u.id}`, u.email] as [string, string]),
        ...(await db.select({ id: serviceAccounts.id, name: serviceAccounts.name }).from(serviceAccounts)).map((a) => [`service:${a.id}`, a.name] as [string, string]),
      ]);
      // Project and instance entries on this cluster (one project's, for a project's tab).
      const below = new RegExp(`^/clusters/${cluster.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/projects/([^/]+)(?:/instances/([^/]+))?$`);
      const placeOf = (path: string) => {
        if (where.has(path)) return where.get(path)!;
        const m = below.exec(path);
        if (!m || (query.project && m[1] !== query.project)) return null;
        return m[2] ? `instance ${m[1]}/${m[2]}` : `project ${m[1]}`;
      };
      const reaching = (await acl.entries()).filter((e) => e.source === "acl" && placeOf(e.path));
      const readable = await Promise.all(reaching.map((e) => acl.can(p, "acl.view", e.path)));
      const entries = reaching
        .filter((_, i) => readable[i])
        .map((e) => {
          const [type, id] = e.subject.split(":") as [string, string];
          const on = placeOf(e.path)!;
          const relation = on.startsWith("instance ") ? instanceRelation(ROLES[e.role].privileges) : roleRelation(e.role, on === "server" ? "server" : "project");
          return { id: e.id, path: e.path, subject: { type, id, name: named.get(e.subject) ?? id }, role: e.role, propagate: e.propagate, relation, on };
        })
        .sort((a, b) => a.path.localeCompare(b.path) || a.subject.name.localeCompare(b.subject.name));

      // Whether the caller may add entries here (the page's own path).
      const canManage = await acl.can(p, "acl.manage", query.project ? `/clusters/${cluster.name}/projects/${query.project}` : `/clusters/${cluster.name}`);
      if (!(await acl.can(p, "platform.view", "/"))) return { cluster: cluster.name, tenants: tenantList, entries, canManage };
      const platformUsers = await db
        .select({ id: users.id, name: users.name, email: users.email, role: platformRoles.role })
        .from(platformRoles)
        .innerJoin(users, eq(users.id, platformRoles.userId))
        .where(eq(users.disabled, false));
      const platformAccounts = await db
        .select({ id: serviceAccounts.id, name: serviceAccounts.name, role: serviceAccounts.platformRole })
        .from(serviceAccounts)
        .where(and(isNotNull(serviceAccounts.platformRole), eq(serviceAccounts.disabled, false)));
      const platform = [
        ...platformUsers.map((u): Holder => ({ id: u.id, kind: "user", name: u.name, email: u.email, role: u.role, relation: serverRelation(u.role) })),
        ...platformAccounts.map((a): Holder => ({ id: a.id, kind: "service-account", name: a.name, role: a.role!, relation: serverRelation(a.role!) })),
      ].sort(byName);
      return { cluster: cluster.name, platform, tenants: tenantList, entries, canManage };
    },
    { query: t.Object({ cluster: t.String({ minLength: 1 }), project: t.Optional(t.String({ minLength: 1 })) }) },
  );
}
