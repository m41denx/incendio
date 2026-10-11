import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { placements, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { tuples } from "../authz/sync.ts";
import { can, forbidden, needVisible, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import type { HydraAdminApi } from "../identity/hydra-admin.ts";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { audited, created, noContent, uuidParam } from "./common.ts";

/** Tenant slugs become Incus project names (spec D5): DNS-label-like, not reserved. */
const SLUG = "^[a-z][a-z0-9-]{1,30}[a-z0-9]$";
const RESERVED = new Set(["default", "incuscloud", "admin", "system"]);
const TenantRole = t.Union([t.Literal("owner"), t.Literal("admin"), t.Literal("member"), t.Literal("viewer")]);
const Quotas = t.Object({ instances: t.Optional(t.Integer({ minimum: 0 })), cpu: t.Optional(t.Integer({ minimum: 0 })), memory: t.Optional(t.Integer({ minimum: 0 })), disk: t.Optional(t.Integer({ minimum: 0 })) }, { additionalProperties: false });

type TenantRow = typeof tenants.$inferSelect;
const view = (x: TenantRow) => ({ id: x.id, slug: x.slug, name: x.name, quotas: x.quotas, createdAt: x.createdAt });

/** Tenants and their members. */
export function tenantsRoutes({ db, authz, hydra }: { db: Db; authz: Authz; hydra: HydraAdminApi }) {
  const load = async (p: Principal, id: string, relation: string) => {
    uuidParam(id);
    await needVisible(authz, p, "viewer", relation, `tenant:${id}`);
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!row) throw notFound();
    return row;
  };
  /** Owners are managed by owners and platform admins only. */
  const needOwnerPower = async (p: Principal, tenantId: string) => {
    if (!(await can(authz, p, "owner", `tenant:${tenantId}`)) && !(await platformCan(authz, p, "admin"))) throw forbidden();
  };
  const ownerCount = async (tenantId: string) => (await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")))).length;

  /** Sets a member's role (insert or change), enforcing owner rules. */
  const setMember = async (p: Principal, tenantId: string, userId: string, role: string) => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound("No such user");
    const [cur] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    if (role === "owner" || cur?.role === "owner") await needOwnerPower(p, tenantId);
    if (cur?.role === "owner" && role !== "owner" && (await ownerCount(tenantId)) <= 1) throw new ApiError(409, "last_owner", "A tenant needs at least one owner");
    if (cur?.role === role) return { userId, role };
    await db.transaction(async (tx) => {
      await tx.insert(tenantMembers).values({ tenantId, userId, role }).onConflictDoUpdate({ target: [tenantMembers.tenantId, tenantMembers.userId], set: { role } });
      await authz.write([tuples.member(tenantId, userId, role)], cur ? [tuples.member(tenantId, userId, cur.role)] : []);
    });
    return { userId, role };
  };

  return new Elysia({ name: "tenants" })
    .use(principalContext)
    .get("/api/v1/tenants", async ({ principal }) => {
      const p = authed(principal);
      if (await platformCan(authz, p, "viewer")) return (await db.select().from(tenants).orderBy(tenants.slug)).map(view);
      if (p.kind === "service") return p.tenantId ? (await db.select().from(tenants).where(eq(tenants.id, p.tenantId))).map(view) : [];
      const rows = await db.select({ t: tenants }).from(tenantMembers).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId)).where(eq(tenantMembers.userId, p.id)).orderBy(tenants.slug);
      return rows.map((r) => view(r.t));
    })
    .post(
      "/api/v1/tenants",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const res = await audited(db, { principal: p, request }, "tenant.create", (r) => r && { type: "tenant", id: r.id }, async () => {
          if (!(await platformCan(authz, p, "operator"))) throw forbidden();
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
    .get("/api/v1/tenants/:id", async ({ principal, params }) => view(await load(authed(principal), params.id, "viewer")))
    .patch(
      "/api/v1/tenants/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "tenant.update", { type: "tenant", id: params.id }, async () => {
          // Names are the tenant's business; quotas are the platform's.
          await load(p, params.id, "viewer");
          if (body.name !== undefined && !(await can(authz, p, "admin", `tenant:${params.id}`))) throw forbidden();
          if (body.quotas !== undefined && !(await platformCan(authz, p, "operator"))) throw forbidden();
          const [row] = await db.update(tenants).set({ ...(body.name !== undefined && { name: body.name }), ...(body.quotas !== undefined && { quotas: body.quotas }) }).where(eq(tenants.id, params.id)).returning();
          return view(row!);
        });
      },
      { body: t.Object({ name: t.Optional(t.String({ minLength: 1, maxLength: 200 })), quotas: t.Optional(Quotas) }) },
    )
    .delete("/api/v1/tenants/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "tenant.delete", { type: "tenant", id: params.id }, async () => {
        await load(p, params.id, "viewer");
        await needOwnerPower(p, params.id);
        if ((await db.select().from(placements).where(eq(placements.tenantId, params.id)).limit(1)).length) {
          throw new ApiError(409, "tenant_placed", "Remove this tenant from its clusters first");
        }
        const members = await db.select().from(tenantMembers).where(eq(tenantMembers.tenantId, params.id));
        const accounts = await db.select().from(serviceAccounts).where(eq(serviceAccounts.tenantId, params.id));
        for (const sa of accounts) await hydra.deleteClient(sa.clientId).catch((e) => log.warn("could not delete Hydra client", { clientId: sa.clientId, error: String(e) }));
        await db.transaction(async (tx) => {
          await tx.delete(tenants).where(eq(tenants.id, params.id));
          await authz.write([], [tuples.tenant(params.id), ...members.map((m) => tuples.member(params.id, m.userId, m.role)), ...accounts.map((a) => tuples.member(params.id, a.id, "member"))]);
        });
      });
      return noContent(set);
    })
    .get("/api/v1/tenants/:id/members", async ({ principal, params }) => {
      await load(authed(principal), params.id, "viewer");
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
          await load(p, params.id, "admin");
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
          await load(p, params.id, "admin");
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
        await load(p, params.id, "admin");
        const [cur] = await db.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, params.id), eq(tenantMembers.userId, uuidParam(params.userId))));
        if (!cur) throw notFound("Not a member");
        if (cur.role === "owner") {
          await needOwnerPower(p, params.id);
          if ((await ownerCount(params.id)) <= 1) throw new ApiError(409, "last_owner", "A tenant needs at least one owner");
        }
        await db.transaction(async (tx) => {
          await tx.delete(tenantMembers).where(and(eq(tenantMembers.tenantId, params.id), eq(tenantMembers.userId, params.userId)));
          await authz.write([], [tuples.member(params.id, params.userId, cur.role)]);
        });
      }, () => ({ userId: params.userId }));
      return noContent(set);
    });
}
