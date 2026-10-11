import { Elysia, t } from "elysia";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { platformRoles, sessions, tenantMembers, users } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { tuples } from "../authz/sync.ts";
import { forbidden, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { hashPassword } from "../identity/passwords.ts";
import type { HydraAdminApi } from "../identity/hydra-admin.ts";
import { ApiError } from "../lib/errors.ts";
import { audited, created, noContent, uuidParam } from "./common.ts";

const PlatformRole = t.Union([t.Literal("admin"), t.Literal("operator"), t.Literal("viewer")]);

type UserRow = typeof users.$inferSelect;
const view = (u: UserRow, role: string | null | undefined) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  disabled: u.disabled,
  platformRole: role ?? null,
  hasPassword: !!u.passwordHash,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

/** Users and their platform roles (platform admins manage, viewers read). */
export function usersRoutes({ db, authz, hydra }: { db: Db; authz: Authz; hydra: HydraAdminApi }) {
  const needPlatform = async (p: Principal, rel: "admin" | "viewer") => {
    if (!(await platformCan(authz, p, rel))) throw forbidden();
  };
  const load = async (id: string) => {
    const [row] = await db.select({ u: users, role: platformRoles.role }).from(users).leftJoin(platformRoles, eq(platformRoles.userId, users.id)).where(eq(users.id, uuidParam(id)));
    if (!row) throw notFound("No such user");
    return row;
  };
  /** Refuses changes that would leave no enabled platform admin. */
  const keepAnAdmin = async (userId: string) => {
    const others = await db
      .select({ id: users.id })
      .from(platformRoles)
      .innerJoin(users, eq(users.id, platformRoles.userId))
      .where(and(eq(platformRoles.role, "admin"), ne(users.id, userId), eq(users.disabled, false)))
      .limit(1);
    if (!others.length) throw new ApiError(409, "last_admin", "This is the last platform administrator");
  };

  return new Elysia({ name: "users" })
    .use(principalContext)
    .get("/api/v1/users", async ({ principal }) => {
      await needPlatform(authed(principal), "viewer");
      const rows = await db.select({ u: users, role: platformRoles.role }).from(users).leftJoin(platformRoles, eq(platformRoles.userId, users.id)).orderBy(users.email);
      return rows.map((r) => view(r.u, r.role));
    })
    .get("/api/v1/users/:id", async ({ principal, params }) => {
      await needPlatform(authed(principal), "viewer");
      const r = await load(params.id);
      return view(r.u, r.role);
    })
    .post(
      "/api/v1/users",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const res = await audited(db, { principal: p, request }, "user.create", (r) => r && { type: "user", id: r.id }, async () => {
          await needPlatform(p, "admin");
          if ((await db.select({ id: users.id }).from(users).where(eq(users.email, body.email))).length) {
            throw new ApiError(409, "email_taken", "A user with this email already exists");
          }
          const passwordHash = body.password ? await hashPassword(body.password) : null;
          return db.transaction(async (tx) => {
            const [u] = await tx.insert(users).values({ email: body.email, name: body.name, passwordHash }).returning();
            if (body.platformRole) {
              await tx.insert(platformRoles).values({ userId: u!.id, role: body.platformRole });
              await authz.write([tuples.platformRole(u!.id, body.platformRole)]);
            }
            return view(u!, body.platformRole);
          });
        }, (u) => ({ email: u.email, platformRole: u.platformRole }));
        return created(set, res);
      },
      {
        body: t.Object({
          email: t.String({ format: "email", maxLength: 254 }),
          name: t.String({ minLength: 1, maxLength: 200 }),
          password: t.Optional(t.String({ minLength: 12, maxLength: 1024 })),
          platformRole: t.Optional(PlatformRole),
        }),
      },
    )
    .patch(
      "/api/v1/users/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "user.update", { type: "user", id: params.id }, async () => {
          await needPlatform(p, "admin");
          const { u, role } = await load(params.id);
          const losesAdmin = role === "admin" && ((body.platformRole !== undefined && body.platformRole !== "admin") || body.disabled === true);
          if (losesAdmin) await keepAnAdmin(u.id);
          return db.transaction(async (tx) => {
            const patch: Partial<UserRow> = {};
            if (body.name !== undefined) patch.name = body.name;
            if (body.disabled !== undefined) patch.disabled = body.disabled;
            if (body.password !== undefined) patch.passwordHash = await hashPassword(body.password);
            const [updated] = Object.keys(patch).length ? await tx.update(users).set(patch).where(eq(users.id, u.id)).returning() : [u];
            if (body.disabled) {
              await tx.delete(sessions).where(eq(sessions.userId, u.id));
              // Clusters accept Hydra tokens directly: end the refresh chains too.
              await hydra.revokeSubject(u.id);
            }
            let newRole = role;
            if (body.platformRole !== undefined && body.platformRole !== role) {
              await tx.delete(platformRoles).where(eq(platformRoles.userId, u.id));
              if (body.platformRole) await tx.insert(platformRoles).values({ userId: u.id, role: body.platformRole });
              await authz.write(body.platformRole ? [tuples.platformRole(u.id, body.platformRole)] : [], role ? [tuples.platformRole(u.id, role)] : []);
              newRole = body.platformRole;
            }
            return view(updated!, newRole);
          });
        }, () => ({ fields: Object.keys(body).map((k) => (k === "password" ? "password(set)" : k)) }));
      },
      {
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
          disabled: t.Optional(t.Boolean()),
          password: t.Optional(t.String({ minLength: 12, maxLength: 1024 })),
          platformRole: t.Optional(t.Union([PlatformRole, t.Null()])),
        }),
      },
    )
    .delete("/api/v1/users/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "user.delete", { type: "user", id: params.id }, async () => {
        await needPlatform(p, "admin");
        const { u, role } = await load(params.id);
        if (role === "admin") await keepAnAdmin(u.id);
        const memberships = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, u.id));
        await db.transaction(async (tx) => {
          await tx.delete(users).where(eq(users.id, u.id));
          await hydra.revokeSubject(u.id);
          await authz.write([], [...(role ? [tuples.platformRole(u.id, role)] : []), ...memberships.map((m) => tuples.member(m.tenantId, u.id, m.role))]);
        });
      });
      return noContent(set);
    });
}
