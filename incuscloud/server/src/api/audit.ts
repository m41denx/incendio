import { Elysia, t } from "elysia";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { auditLog } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { need, platformCan, forbidden } from "../authz/guards.ts";
import { authed, principalContext } from "../auth/principal.ts";
import { uuidParam } from "./common.ts";

/** The audit log: platform viewers see everything, tenant admins their tenant (`?tenant=`). */
export function auditRoutes({ db, authz }: { db: Db; authz: Authz }) {
  return new Elysia({ name: "audit" }).use(principalContext).get(
    "/api/v1/audit",
    async ({ principal, query }) => {
      const p = authed(principal);
      const where: SQL[] = [];
      if (query.tenant) {
        const tid = uuidParam(query.tenant);
        await need(authz, p, "admin", `tenant:${tid}`);
        where.push(or(and(eq(auditLog.targetType, "tenant"), eq(auditLog.targetId, tid)), sql`${auditLog.detail}->>'tenantId' = ${tid}`)!);
      } else if (!(await platformCan(authz, p, "viewer"))) {
        throw forbidden();
      }
      if (query.actor) where.push(eq(auditLog.actorId, query.actor));
      if (query.action) where.push(eq(auditLog.action, query.action));
      if (query.targetType) where.push(eq(auditLog.targetType, query.targetType));
      if (query.targetId) where.push(eq(auditLog.targetId, query.targetId));
      if (query.before) where.push(lt(auditLog.id, query.before));
      return db
        .select()
        .from(auditLog)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(auditLog.id))
        .limit(query.limit ?? 100);
    },
    {
      query: t.Object({
        tenant: t.Optional(t.String()),
        actor: t.Optional(t.String()),
        action: t.Optional(t.String()),
        targetType: t.Optional(t.String()),
        targetId: t.Optional(t.String()),
        before: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
      }),
    },
  );
}
