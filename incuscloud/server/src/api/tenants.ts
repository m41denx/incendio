import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, userQuotas, users } from "../db/schema.ts";
import { entriesUnder } from "./acl.ts";
import type { Acl } from "../acl/acl.ts";
import { needOutrank } from "../acl/outrank.ts";
import type { Authz } from "../authz/platform.ts";
import { tuples } from "../authz/sync.ts";
import { forbidden, needTenant, notFound } from "../authz/guards.ts";
import type { Privilege } from "../acl/catalog.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import type { HydraAdminApi } from "../identity/hydra-admin.ts";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { audited, created, filterAsync, noContent, uuidParam } from "./common.ts";
import { userUsage } from "../tenants/limits.ts";
import { requestReconcile } from "../reconcile/requests.ts";
import { dropTenantLeases, leaseView, tenantLeases } from "../leases/leases.ts";

/** Tenant slugs become Incus project names (spec D5): DNS-label-like, not reserved. */
const SLUG = "^[a-z][a-z0-9-]{1,30}[a-z0-9]$";
const RESERVED = new Set(["default", "incuscloud", "admin", "system"]);
const TenantRole = t.Union([t.Literal("owner"), t.Literal("admin"), t.Literal("member"), t.Literal("viewer")]);
const Count = t.Optional(t.Integer({ minimum: 0 }));
const Quotas = t.Object(
  { instances: Count, cpu: Count, memory: Count, disk: Count, maxInstanceCpu: Count, maxInstanceMemory: Count, maxInstanceDisk: Count, snapshots: Count, backups: Count, backupGiB: Count, kubernetes: Count },
  { additionalProperties: false },
);

type TenantRow = typeof tenants.$inferSelect;
const view = (x: TenantRow) => ({ id: x.id, slug: x.slug, name: x.name, quotas: x.quotas, leasePolicy: x.leasePolicy, createdAt: x.createdAt });
const Days = t.Integer({ minimum: 1, maximum: 3650 });
const LeasePolicy = t.Object(
  { days: Days, action: t.Union([t.Literal("stop"), t.Literal("delete")]), extendDays: Days, maxExtensions: t.Integer({ minimum: 0, maximum: 1000 }) },
  { additionalProperties: false },
);

/** Tenants and their members. */
export function tenantsRoutes({ db, authz, acl, hydra }: { db: Db; authz: Authz; acl: Acl; hydra: HydraAdminApi }) {
  const load = async (p: Principal, id: string, privilege: Privilege = "tenant.view") => {
    uuidParam(id);
    await needTenant(db, acl, p, id, privilege);
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!row) throw notFound();
    return row;
  };
  /** Owners are managed by owners (the membership, not an entry) and platform admins only. */
  const needOwnerPower = async (p: Principal, tenantId: string) => {
    const owner = p.kind === "user" && (await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, p.id), eq(tenantMembers.role, "owner")))).length > 0;
    if (!owner && !(await acl.can(p, "platform.users", "/"))) throw forbidden();
  };
  const ownerCount = async (tenantId: string) => (await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")))).length;

  /** Sets a member's role (insert or change), enforcing owner rules. */
  const setMember = async (p: Principal, tenantId: string, userId: string, role: string) => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound("No such user");
    const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    const [cur] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    if (role === "owner" || cur?.role === "owner") await needOwnerPower(p, tenantId);
    // A tenant role is the most specific entry there: it would narrow platform staff (permissions).
    await needOutrank(acl, p, `/tenants/${tenant!.slug}`, [`user:${userId}`]);
    // Whoever may still do it is told that the tenant role replaces a platform role on this tenant.
    const [platform] = await db.select({ role: platformRoles.role }).from(platformRoles).where(eq(platformRoles.userId, userId));
    const replacesPlatformRole = platform?.role ?? null;
    if (cur?.role === "owner" && role !== "owner" && (await ownerCount(tenantId)) <= 1) throw new ApiError(409, "last_owner", "A tenant needs at least one owner");
    if (cur?.role === role) return { userId, role, replacesPlatformRole };
    await db.transaction(async (tx) => {
      await tx.insert(tenantMembers).values({ tenantId, userId, role }).onConflictDoUpdate({ target: [tenantMembers.tenantId, tenantMembers.userId], set: { role } });
      await authz.write([tuples.member(tenantId, userId, role)], cur ? [tuples.member(tenantId, userId, cur.role)] : []);
    });
    await requestReconcile(db, { tenant: tenantId });
    return { userId, role, replacesPlatformRole };
  };

  return new Elysia({ name: "tenants" })
    .use(principalContext)
    .get("/api/v1/tenants", async ({ principal }) => {
      const p = authed(principal);
      const rows = await db.select().from(tenants).orderBy(tenants.slug);
      return (await filterAsync(rows, (r) => acl.can(p, "tenant.view", `/tenants/${r.slug}`))).map(view);
    })
    .post(
      "/api/v1/tenants",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const res = await audited(db, { principal: p, request }, "tenant.create", (r) => r && { type: "tenant", id: r.id }, async () => {
          if (!(await acl.can(p, "tenant.manage", "/"))) throw forbidden();
          if (RESERVED.has(body.slug)) throw new ApiError(400, "invalid_request", `"${body.slug}" is reserved`);
          if ((await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, body.slug))).length) throw new ApiError(409, "slug_taken", "A tenant with this slug already exists");
          if (body.ownerId && !(await db.select({ id: users.id }).from(users).where(eq(users.id, uuidParam(body.ownerId, "No such user")))).length) throw notFound("No such user");
          return db.transaction(async (tx) => {
            const [row] = await tx.insert(tenants).values({ slug: body.slug, name: body.name, quotas: body.quotas ?? {} }).returning();
            const writes = [tuples.tenant(row!.id)];
            if (body.ownerId) {
              await tx.insert(tenantMembers).values({ tenantId: row!.id, userId: body.ownerId, role: "owner" });
              writes.push(tuples.member(row!.id, body.ownerId, "owner"));
            }
            await authz.write(writes);
            return view(row!);
          });
        }, (r) => ({ tenantId: r.id, slug: r.slug }));
        return created(set, res);
      },
      { body: t.Object({ slug: t.String({ pattern: SLUG }), name: t.String({ minLength: 1, maxLength: 200 }), quotas: t.Optional(Quotas), ownerId: t.Optional(t.String()) }) },
    )
    .get("/api/v1/tenants/:id", async ({ principal, params }) => view(await load(authed(principal), params.id)))
    .patch(
      "/api/v1/tenants/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "tenant.update", { type: "tenant", id: params.id }, async () => {
          // Names are the tenant's business; quotas are the platform's.
          const t = await load(p, params.id);
          if (body.name !== undefined && !(await acl.can(p, "tenant.manage", `/tenants/${t.slug}`))) throw forbidden();
          // The quota is the platform's limit on the tenant: decided on /, so no entry on the tenant raises it.
          if (body.quotas !== undefined && !(await acl.can(p, "tenant.quota", "/"))) throw forbidden();
          const [row] = await db.update(tenants).set({ ...(body.name !== undefined && { name: body.name }), ...(body.quotas !== undefined && { quotas: body.quotas }) }).where(eq(tenants.id, params.id)).returning();
          if (body.quotas !== undefined) await requestReconcile(db, { tenant: params.id });
          return view(row!);
        });
      },
      { body: t.Object({ name: t.Optional(t.String({ minLength: 1, maxLength: 200 })), quotas: t.Optional(Quotas) }) },
    )
    .delete("/api/v1/tenants/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "tenant.delete", { type: "tenant", id: params.id }, async () => {
        const tenant = await load(p, params.id);
        await needOwnerPower(p, params.id);
        if ((await db.select().from(placements).where(eq(placements.tenantId, params.id)).limit(1)).length) {
          throw new ApiError(409, "tenant_placed", "Remove this tenant from its clusters first");
        }
        const members = await db.select().from(tenantMembers).where(eq(tenantMembers.tenantId, params.id));
        const accounts = await db.select().from(serviceAccounts).where(eq(serviceAccounts.tenantId, params.id));
        for (const sa of accounts) await hydra.deleteClient(sa.clientId).catch((e) => log.warn("could not delete Hydra client", { clientId: sa.clientId, error: String(e) }));
        await db.transaction(async (tx) => {
          await tx.delete(tenants).where(eq(tenants.id, params.id));
          await tx.delete(aclEntries).where(entriesUnder(`/tenants/${tenant.slug}`));
          await authz.write([], [tuples.tenant(params.id), ...members.map((m) => tuples.member(params.id, m.userId, m.role)), ...accounts.map((a) => tuples.member(params.id, a.id, "member"))]);
        });
      });
      return noContent(set);
    })
    .get("/api/v1/tenants/:id/placements", async ({ principal, params }) => {
      await load(authed(principal), params.id);
      return db
        .select({ clusterId: placements.clusterId, clusterName: clusters.name, project: placements.project, status: placements.status, statusMessage: placements.statusMessage, createdAt: placements.createdAt })
        .from(placements)
        .innerJoin(clusters, eq(clusters.id, placements.clusterId))
        .where(eq(placements.tenantId, params.id))
        .orderBy(clusters.name);
    })
    // Leases (permissions phase 6): the policy is the platform's limit on the tenant, like its quota.
    .put(
      "/api/v1/tenants/:id/lease-policy",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "tenant.lease_policy.set", { type: "tenant", id: params.id }, async () => {
          const before = await load(p, params.id);
          if (!(await acl.can(p, "tenant.quota", "/"))) throw forbidden();
          const [row] = await db.update(tenants).set({ leasePolicy: body.policy }).where(eq(tenants.id, before.id)).returning();
          // Without a policy, leases are gone; a later policy hands out fresh ones.
          if (!body.policy) await dropTenantLeases(db, before.id);
          return view(row!);
        }, () => ({ policy: body.policy }));
      },
      { body: t.Object({ policy: t.Union([LeasePolicy, t.Null()]) }) },
    )
    // The tenant's leases the caller may see (instance.view on each), soonest end first.
    .get("/api/v1/tenants/:id/leases", async ({ principal, params }) => {
      const p = authed(principal);
      const tenant = await load(p, params.id);
      if (!tenant.leasePolicy) return { policy: null, canSet: await acl.can(p, "tenant.quota", "/"), leases: [] };
      const rows = await tenantLeases(db, tenant.id);
      const visible = await filterAsync(rows, async (r) => {
        const path = await acl.instancePath(r.lease.clusterId, r.lease.project, r.lease.name);
        return !!path && (await acl.can(p, "instance.view", path));
      });
      const names = new Map((await db.select({ id: clusters.id, name: clusters.name }).from(clusters)).map((c) => [c.id, c.name]));
      return {
        policy: tenant.leasePolicy,
        canSet: await acl.can(p, "tenant.quota", "/"),
        leases: visible.map((r) => ({
          instanceId: r.instanceId,
          cluster: names.get(r.lease.clusterId) ?? r.lease.clusterId,
          project: r.lease.project,
          name: r.lease.name,
          status: r.status,
          ...leaseView(r.lease, tenant.leasePolicy)!,
        })),
      };
    })
    // Users' quotas inside the tenant (permissions phase 4): set by tenant.quota holders there, never above the tenant's.
    .get("/api/v1/tenants/:id/user-quotas", async ({ principal, params }) => {
      const p = authed(principal);
      const t = await load(p, params.id);
      const manage = await acl.can(p, "tenant.quota", `/tenants/${t.slug}`);
      const rows = await db.select({ userId: userQuotas.userId, quotas: userQuotas.quotas, email: users.email }).from(userQuotas).innerJoin(users, eq(users.id, userQuotas.userId)).where(eq(userQuotas.tenantId, t.id));
      // Others see only their own.
      const shown = manage ? rows : rows.filter((r) => r.userId === p.id);
      return Promise.all(shown.map(async (r) => ({ ...r, used: await userUsage(db, t.id, r.userId) })));
    })
    .put(
      "/api/v1/tenants/:id/user-quotas/:userId",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "tenant.user_quota.set", { type: "tenant", id: params.id }, async () => {
          const t = await load(p, params.id, "tenant.quota");
          const userId = uuidParam(params.userId, "No such user");
          if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, userId))).length) throw notFound("No such user");
          for (const k of ["instances", "cpu", "memory"] as const) {
            const cap = t.quotas[k];
            if (body.quotas[k] !== undefined && cap !== undefined && body.quotas[k]! > cap) throw new ApiError(400, "invalid_request", `A user's ${k} cannot be above the tenant's (${cap})`);
          }
          if (body.quotas.backups !== undefined && t.quotas.backups !== undefined && body.quotas.backups > t.quotas.backups) throw new ApiError(400, "invalid_request", `A user's backups cannot be above the tenant's (${t.quotas.backups})`);
          if (!Object.keys(body.quotas).length) {
            await db.delete(userQuotas).where(and(eq(userQuotas.tenantId, t.id), eq(userQuotas.userId, userId)));
          } else {
            await db.insert(userQuotas).values({ tenantId: t.id, userId, quotas: body.quotas }).onConflictDoUpdate({ target: [userQuotas.tenantId, userQuotas.userId], set: { quotas: body.quotas } });
          }
          return { userId, quotas: body.quotas };
        });
      },
      { body: t.Object({ quotas: t.Object({ instances: Count, cpu: Count, memory: Count, backups: Count }, { additionalProperties: false }) }) },
    )
    .get("/api/v1/tenants/:id/members", async ({ principal, params }) => {
      await load(authed(principal), params.id);
      return db
        .select({ userId: users.id, email: users.email, name: users.name, role: tenantMembers.role })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(eq(tenantMembers.tenantId, params.id))
        .orderBy(users.email);
    })
    .put(
      "/api/v1/tenants/:id/members/:userId",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "tenant.member.set", { type: "tenant", id: params.id }, async () => {
          await load(p, params.id, "tenant.members");
          return setMember(p, params.id, uuidParam(params.userId, "No such user"), body.role);
        }, (r) => ({ userId: r.userId, role: r.role }));
      },
      { body: t.Object({ role: TenantRole }) },
    )
    .post(
      "/api/v1/tenants/:id/members",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "tenant.member.set", { type: "tenant", id: params.id }, async () => {
          await load(p, params.id, "tenant.members");
          const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
          if (!u) throw notFound("No user with this email; ask a platform administrator to create the account");
          return setMember(p, params.id, u.id, body.role);
        }, (r) => ({ userId: r.userId, role: r.role }));
      },
      { body: t.Object({ email: t.String({ maxLength: 254 }), role: TenantRole }) },
    )
    .delete("/api/v1/tenants/:id/members/:userId", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "tenant.member.remove", { type: "tenant", id: params.id }, async () => {
        const tenant = await load(p, params.id, "tenant.members");
        const [cur] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, params.id), eq(tenantMembers.userId, uuidParam(params.userId))));
        if (!cur) throw notFound("Not a member");
        await needOutrank(acl, p, `/tenants/${tenant.slug}`, [`user:${cur.userId}`]);
        if (cur.role === "owner") {
          await needOwnerPower(p, params.id);
          if ((await ownerCount(params.id)) <= 1) throw new ApiError(409, "last_owner", "A tenant needs at least one owner");
        }
        await db.transaction(async (tx) => {
          await tx.delete(tenantMembers).where(and(eq(tenantMembers.tenantId, params.id), eq(tenantMembers.userId, params.userId)));
          await authz.write([], [tuples.member(params.id, params.userId, cur.role)]);
        });
        await requestReconcile(db, { tenant: params.id });
      }, () => ({ userId: params.userId }));
      return noContent(set);
    });
}
