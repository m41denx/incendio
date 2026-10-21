import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { groupMembers, groups, serviceAccounts, users } from "../db/schema.ts";
import type { Acl } from "../acl/acl.ts";
import { forbidden, notFound } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { requestReconcile } from "../reconcile/requests.ts";
import { audited, created, noContent, uuidParam } from "./common.ts";

const NAME = "^[a-z0-9][a-z0-9._-]{0,62}$";

/**
 * IncusCloud's groups (permissions phase 3): users and service accounts that
 * entries can name together. Managed with `platform.users`, read with
 * `platform.view`. Each tenant's default group (`<tenant>/members`) is not
 * here: it is the tenant's membership, always.
 */
export function groupsRoutes({ db, acl }: { db: Db; acl: Acl }) {
  const need = async (p: Principal, privilege: "platform.users" | "platform.view") => {
    if (!(await acl.can(p, privilege, "/"))) throw forbidden();
  };
  const load = async (id: string) => {
    const [g] = await db.select().from(groups).where(eq(groups.id, uuidParam(id, "Group not found")));
    if (!g) throw notFound("Group not found");
    return g;
  };
  const membersOf = async (groupId: string) => {
    const rows = await db
      .select({ userId: groupMembers.userId, email: users.email, serviceAccountId: groupMembers.serviceAccountId, account: serviceAccounts.name })
      .from(groupMembers)
      .leftJoin(users, eq(users.id, groupMembers.userId))
      .leftJoin(serviceAccounts, eq(serviceAccounts.id, groupMembers.serviceAccountId))
      .where(eq(groupMembers.groupId, groupId));
    return rows.map((r) => (r.userId ? { type: "user" as const, id: r.userId, name: r.email ?? r.userId } : { type: "service" as const, id: r.serviceAccountId!, name: r.account ?? r.serviceAccountId! }));
  };
  // Membership changes who resolves to what, in IncusCloud and in Incus.
  const changed = async () => {
    acl.invalidate();
    await requestReconcile(db, "all");
  };

  return new Elysia({ name: "groups" })
    .use(principalContext)
    .get("/api/v1/groups", async ({ principal }) => {
      await need(authed(principal), "platform.view");
      const list = await db.select().from(groups).orderBy(groups.name);
      return Promise.all(list.map(async (g) => ({ ...g, members: await membersOf(g.id) })));
    })
    .get("/api/v1/groups/:id", async ({ principal, params }) => {
      await need(authed(principal), "platform.view");
      const g = await load(params.id);
      return { ...g, members: await membersOf(g.id) };
    })
    .post(
      "/api/v1/groups",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const g = await audited(db, { principal: p, request }, "group.create", (r) => r && { type: "group", id: r.id }, async () => {
          await need(p, "platform.users");
          if ((await db.select({ id: groups.id }).from(groups).where(eq(groups.name, body.name))).length) throw new ApiError(409, "conflict", `A group named "${body.name}" already exists`);
          const [row] = await db.insert(groups).values({ name: body.name, description: body.description ?? "" }).returning();
          return row!;
        });
        return created(set, { ...g, members: [] });
      },
      { body: t.Object({ name: t.String({ pattern: NAME }), description: t.Optional(t.String({ maxLength: 500 })) }) },
    )
    .patch(
      "/api/v1/groups/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "group.update", { type: "group", id: params.id }, async () => {
          await need(p, "platform.users");
          await load(params.id);
          const [row] = await db.update(groups).set({ description: body.description }).where(eq(groups.id, params.id)).returning();
          return row!;
        });
      },
      { body: t.Object({ description: t.String({ maxLength: 500 }) }) },
    )
    .delete("/api/v1/groups/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "group.delete", { type: "group", id: params.id }, async () => {
        await need(p, "platform.users");
        await load(params.id);
        // Its members and entries go with it (foreign keys).
        await db.delete(groups).where(eq(groups.id, params.id));
        await changed();
      });
      return noContent(set);
    })
    .put("/api/v1/groups/:id/members/:type/:memberId", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "group.member.add", { type: "group", id: params.id }, async () => {
        await need(p, "platform.users");
        await load(params.id);
        const id = uuidParam(params.memberId, "No such member");
        if (params.type === "user") {
          if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, id))).length) throw notFound("No such user");
          await db.insert(groupMembers).values({ groupId: params.id, userId: id }).onConflictDoNothing();
        } else if (params.type === "service") {
          if (!(await db.select({ id: serviceAccounts.id }).from(serviceAccounts).where(eq(serviceAccounts.id, id))).length) throw notFound("No such service account");
          await db.insert(groupMembers).values({ groupId: params.id, serviceAccountId: id }).onConflictDoNothing();
        } else throw new ApiError(400, "invalid_request", "A member is a user or a service account");
        await changed();
      });
      return noContent(set);
    })
    .delete("/api/v1/groups/:id/members/:type/:memberId", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "group.member.remove", { type: "group", id: params.id }, async () => {
        await need(p, "platform.users");
        await load(params.id);
        const id = uuidParam(params.memberId, "No such member");
        const col = params.type === "service" ? groupMembers.serviceAccountId : groupMembers.userId;
        await db.delete(groupMembers).where(and(eq(groupMembers.groupId, params.id), eq(col, id), params.type === "service" ? isNull(groupMembers.userId) : isNull(groupMembers.serviceAccountId)));
        await changed();
      });
      return noContent(set);
    });
}
