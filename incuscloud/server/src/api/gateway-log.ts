import { Elysia, t } from "elysia";
import { and, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { gatewayRequests, serviceAccounts, tenantMembers } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { forbidden, need, platformCan } from "../authz/guards.ts";
import { authed, principalContext } from "../auth/principal.ts";
import { uuidParam } from "./common.ts";

/** Gateway requests: platform viewers see all; tenant admins (`?tenant=`) their members' and service accounts'. */
export function gatewayLogRoutes({ db, authz }: { db: Db; authz: Authz }) {
  return new Elysia({ name: "gateway-log" }).use(principalContext).get(
    "/api/v1/gateway-requests",
    async ({ principal, query }) => {
      const p = authed(principal);
      const where: SQL[] = [];
      if (query.tenant) {
        const tid = uuidParam(query.tenant);
        await need(authz, p, "admin", `tenant:${tid}`);
        const members = (await db.select({ id: tenantMembers.userId }).from(tenantMembers).where(eq(tenantMembers.tenantId, tid))).map((r) => r.id);
        const accounts = (await db.select({ id: serviceAccounts.id }).from(serviceAccounts).where(eq(serviceAccounts.tenantId, tid))).map((r) => r.id);
        const actors = [...members, ...accounts];
        if (!actors.length) return [];
        where.push(inArray(gatewayRequests.actorId, actors));
      } else if (!(await platformCan(authz, p, "viewer"))) {
        throw forbidden();
      }
      if (query.cluster) where.push(eq(gatewayRequests.clusterId, uuidParam(query.cluster)));
      if (query.actor) where.push(eq(gatewayRequests.actorId, query.actor));
      if (query.before) where.push(lt(gatewayRequests.id, query.before));
      return db
        .select()
        .from(gatewayRequests)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(gatewayRequests.id))
        .limit(query.limit ?? 100);
    },
    {
      query: t.Object({
        tenant: t.Optional(t.String()),
        cluster: t.Optional(t.String()),
        actor: t.Optional(t.String()),
        before: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
      }),
    },
  );
}
