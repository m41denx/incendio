import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, clusters, instances, k8sClusters, placements, serviceAccounts, tenants, users } from "../db/schema.ts";
import { subjectOf, type Acl } from "../acl/acl.ts";
import { keepAnAdministrator } from "../acl/admins.ts";
import { needOutrank } from "../acl/outrank.ts";
import { ROLES, isRoleId, type RoleId } from "../acl/catalog.ts";
import { parsePath } from "../acl/paths.ts";
import type { Entry } from "../acl/resolve.ts";
import { forbidden, needPriv, notFound } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { requestReconcile } from "../reconcile/requests.ts";
import { audited, created, isUuid, noContent } from "./common.ts";

/** Roles and paths that can be given so far: groups (Group owner, group paths) come in phase 3. */
const GIVABLE = new Set<RoleId>(["administrator", "operator", "cluster-owner", "unrestricted-user", "user", "tenant-admin", "auditor", "no-access"]);
const PATH_KINDS = ["root", "cluster", "tenant", "project", "instance", "kubernetes"];
const ONLY_ADMINS = new Set<RoleId>(["administrator", "cluster-owner"]);
const EDITED_ON: Record<Exclude<Entry["source"], "acl">, string> = { "platform-role": "users", "tenant-membership": "tenants", "service-account": "service-accounts" };
const bad = (code: string, message: string) => new ApiError(400, code, message);

/** Permissions: roles, entries (explicit, and today's roles read as entries) and what they resolve to. */
export function aclRoutes({ db, acl }: { db: Db; acl: Acl }) {
  const names = async () => {
    const [us, sas] = await Promise.all([db.select({ id: users.id, email: users.email }).from(users), db.select({ id: serviceAccounts.id, name: serviceAccounts.name }).from(serviceAccounts)]);
    return new Map<string, string>([...us.map((u) => [`user:${u.id}`, u.email] as const), ...sas.map((s) => [`service:${s.id}`, s.name] as const)]);
  };
  const view = (e: Entry, named: Map<string, string>) => {
    const [type, id] = e.subject.split(":") as [string, string];
    return {
      id: e.id,
      path: e.path,
      subject: { type, id, name: named.get(e.subject) ?? id },
      role: e.role,
      propagate: e.propagate,
      source: e.source,
      editable: e.source === "acl",
      ...(e.source !== "acl" && { editedOn: EDITED_ON[e.source] }),
    };
  };
  /** The cluster ids whose Incus grants an entry on `path` can change ([] for none). */
  const affected = async (path: string): Promise<"all" | string[]> => {
    const k8s = /^\/tenants\/([^/]+)\/kubernetes\/([^/]+)$/.exec(path);
    if (k8s) {
      const rows = await db.select({ id: k8sClusters.clusterId }).from(k8sClusters).innerJoin(tenants, eq(tenants.id, k8sClusters.tenantId)).where(and(eq(tenants.slug, k8s[1]!), eq(k8sClusters.name, k8s[2]!)));
      return rows.map((r) => r.id);
    }
    if (path === "/" || path.startsWith("/tenants/")) return "all";
    const name = /^\/clusters\/([^/]+)/.exec(path)?.[1];
    if (!name) return [];
    return (await db.select({ id: clusters.id }).from(clusters).where(eq(clusters.name, name))).map((c) => c.id);
  };
  /** Whether the object a path names exists (projects: placed or in the inventory). */
  const objectExists = async (path: NonNullable<ReturnType<typeof parsePath>>): Promise<boolean> => {
    const clusterId = async (name: string) => (await db.select({ id: clusters.id }).from(clusters).where(eq(clusters.name, name)))[0]?.id;
    switch (path.kind) {
      case "root":
        return true;
      case "cluster":
        return !!(await clusterId(path.cluster));
      case "tenant":
        return (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, path.tenant))).length > 0;
      case "project": {
        const id = await clusterId(path.cluster);
        if (!id) return false;
        const placed = await db.select({ p: placements.project }).from(placements).where(and(eq(placements.clusterId, id), eq(placements.project, path.project)));
        return placed.length > 0 || (await db.select({ n: instances.name }).from(instances).where(and(eq(instances.clusterId, id), eq(instances.project, path.project))).limit(1)).length > 0;
      }
      case "instance": {
        const id = await clusterId(path.cluster);
        return !!id && (await db.select({ n: instances.name }).from(instances).where(and(eq(instances.clusterId, id), eq(instances.project, path.project), eq(instances.name, path.instance)))).length > 0;
      }
      case "kubernetes":
        return (await db.select({ id: k8sClusters.id }).from(k8sClusters).innerJoin(tenants, eq(tenants.id, k8sClusters.tenantId)).where(and(eq(tenants.slug, path.tenant), eq(k8sClusters.name, path.name)))).length > 0;
      default:
        return false;
    }
  };
  const isAdministrator = async (p: Principal) => (await acl.explain(subjectOf(p), "/")).decidedBy.some((e) => e.role === "administrator");
  /** An entry may change only with acl.manage on its path; administrator and cluster owner are for administrators to give. */
  const needManage = async (p: Principal, path: string, role: RoleId) => {
    await needPriv(acl, p, "acl.manage", path);
    if (ONLY_ADMINS.has(role) && !(await isAdministrator(p))) throw forbidden();
  };

  return new Elysia({ name: "acl" })
    .use(principalContext)
    .get("/api/v1/acl/roles", ({ principal }) => {
      authed(principal);
      return Object.entries(ROLES).map(([id, r]) => ({ id, name: r.name, privileges: [...r.privileges].sort(), ...(r.ownedOnly && { ownedOnly: [...r.ownedOnly].sort() }) }));
    })
    .get(
      "/api/v1/acl/entries",
      async ({ principal, query }) => {
        const p = authed(principal);
        const at = query.path ?? "/";
        if (!parsePath(at)) throw bad("invalid_path", "Not a permissions path");
        const within = (x: string) => at === "/" || x === at || x.startsWith(`${at}/`);
        const all = (await acl.entries()).filter((e) => within(e.path));
        const ok = await Promise.all(all.map((e) => acl.can(p, "acl.view", e.path)));
        const named = await names();
        return all
          .filter((_, i) => ok[i])
          .map((e) => view(e, named))
          .sort((a, b) => a.path.localeCompare(b.path) || a.subject.name.localeCompare(b.subject.name) || a.role.localeCompare(b.role));
      },
      { query: t.Object({ path: t.Optional(t.String({ maxLength: 512 })) }) },
    )
    .post(
      "/api/v1/acl/entries",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const res = await audited(db, { principal: p, request }, "acl.entry.create", (r) => r && { type: "acl_entry", id: r.id }, async () => {
          const path = parsePath(body.path);
          if (!path || !PATH_KINDS.includes(path.kind)) throw bad("invalid_path", "Entries go on /, a cluster, a project, an instance, a tenant or a Kubernetes cluster for now");
          if (!isRoleId(body.role) || !GIVABLE.has(body.role)) throw bad("invalid_role", "Not a role that can be given yet");
          // On a cluster or / it would reach every tenant's projects (spec: with groups, phase 3).
          if (body.role === "unrestricted-user" && (path.kind === "root" || path.kind === "cluster")) throw bad("invalid_role", "Unrestricted user goes on a tenant or a project for now");
          const role = body.role;
          await needManage(p, body.path, role);
          await needOutrank(acl, p, body.path, [`${body.subject.type}:${body.subject.id}`]);
          if (!(await objectExists(path))) throw bad("invalid_path", "Nothing there: no such cluster, project, instance, tenant or Kubernetes cluster");
          const { type, id } = body.subject;
          const exists = isUuid(id) && (type === "user" ? await db.select({ id: users.id }).from(users).where(eq(users.id, id)) : await db.select({ id: serviceAccounts.id }).from(serviceAccounts).where(eq(serviceAccounts.id, id))).length;
          if (!exists) throw bad("invalid_subject", "No such user or service account");
          // No access on / takes everything there from its holder.
          if (type === "user" && body.path === "/" && role === "no-access") await keepAnAdministrator(db, (h) => h.userId === id);
          const [row] = await db
            .insert(aclEntries)
            .values({ path: body.path, role, propagate: body.propagate, ...(type === "user" ? { userId: id } : { serviceAccountId: id }), createdBy: p.kind === "user" ? p.id : null })
            .onConflictDoNothing()
            .returning();
          if (!row) throw new ApiError(409, "entry_exists", "This entry exists");
          acl.invalidate();
          const targets = await affected(body.path);
          if (targets === "all" || targets.length) await requestReconcile(db, targets);
          return view({ id: row.id, path: row.path, subject: `${type}:${id}`, role, propagate: row.propagate, source: "acl" }, await names());
        }, (r) => ({ path: r.path, subject: `${r.subject.type}:${r.subject.id}`, role: r.role, propagate: r.propagate }));
        return created(set, res);
      },
      {
        body: t.Object({
          path: t.String({ maxLength: 512 }),
          subject: t.Object({ type: t.Union([t.Literal("user"), t.Literal("service")]), id: t.String({ maxLength: 64 }) }),
          role: t.String({ maxLength: 64 }),
          propagate: t.Boolean({ default: true }),
        }),
      },
    )
    .delete("/api/v1/acl/entries/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "acl.entry.delete", { type: "acl_entry", id: params.id }, async () => {
        const [row] = isUuid(params.id) ? await db.select().from(aclEntries).where(eq(aclEntries.id, params.id)) : [];
        if (!row || !isRoleId(row.role)) throw notFound("No such entry");
        await needManage(p, row.path, row.role);
        // Nor undo what someone above the caller decided.
        await needOutrank(acl, p, row.path, [row.userId ? `user:${row.userId}` : `service:${row.serviceAccountId}`, ...(row.createdBy ? [`user:${row.createdBy}`] : [])]);
        await keepAnAdministrator(db, (h) => h.via === "entry" && h.entryId === row.id);
        await db.delete(aclEntries).where(eq(aclEntries.id, row.id));
        acl.invalidate();
        const targets = await affected(row.path);
        if (targets === "all" || targets.length) await requestReconcile(db, targets);
      });
      return noContent(set);
    })
    .get(
      "/api/v1/acl/check",
      async ({ principal, query }) => {
        const p = authed(principal);
        if (!/^(user|service):[0-9a-f-]{36}$/i.test(query.subject)) throw bad("invalid_subject", "subject is user:<id> or service:<id>");
        if (!parsePath(query.path)) throw bad("invalid_path", "Not a permissions path");
        await needPriv(acl, p, "acl.view", query.path);
        const r = await acl.explain(query.subject, query.path);
        const named = await names();
        return { privileges: r.privileges, decidedBy: r.decidedBy.map((e) => view(e, named)) };
      },
      { query: t.Object({ subject: t.String({ maxLength: 80 }), path: t.String({ maxLength: 512 }) }) },
    );
}

/** Entries under a path that is going away (a cluster or tenant deleted): a new one of the same name starts clean. */
export { entriesUnder } from "../acl/entries.ts";
