import { Elysia, t } from "elysia";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { auditLog } from "../db/schema.ts";
import type { Acl } from "../acl/acl.ts";
import { forbidden } from "../authz/guards.ts";
import { authed, principalContext } from "../auth/principal.ts";
import { uuidParam } from "./common.ts";

/** The audit log: platform viewers see everything, tenant admins their tenant (`?tenant=`). */
export function auditRoutes({ db, acl }: { db: Db; acl: Acl }) {
  return new Elysia({ name: "audit" }).use(principalContext).get(
    "/api/v1/audit",
    async ({ principal, query }) => {
      const p = authed(principal);
      const where: SQL[] = [];
      if (query.tenant) {
        const tid = uuidParam(query.tenant);
        // A tenant's log is for whoever may read its permissions (its admins, an Auditor there).
        const slug = (await acl.lookup()).tenantSlugs.get(tid);
        if (!slug || !(await acl.can(p, "acl.view", `/tenants/${slug}`))) throw forbidden();
        where.push(or(and(eq(auditLog.targetType, "tenant"), eq(auditLog.targetId, tid)), sql`${auditLog.detail}->>'tenantId' = ${tid}`)!);
      } else if (!(await acl.can(p, "platform.audit", "/"))) {
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
