import { Elysia, t } from "elysia";
import type { Acl } from "../acl/acl.ts";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { replicationPolicies } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { can, forbidden, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { policyInstanceKey } from "../mobility/replication.ts";
import { audited, created, noContent, uuidParam, visibleTenants } from "./common.ts";
import { resolveTarget, visibleInventoryInstance } from "./mobility.ts";

const NAME = "^[a-zA-Z][a-zA-Z0-9-]{0,62}$";
const Interval = t.Integer({ minimum: 60, maximum: 604800 });

const uniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x.code === "23505" || x.cause?.code === "23505";
};

/** Replication policies (P6): readable like their tenant; managed by its owners and admins, and platform operators. */
export function replicationRoutes({ db, authz, acl }: { db: Db; authz: Authz; acl: Acl }) {
  const visibility = async (p: Principal): Promise<SQL | undefined | null> => {
    const v = await visibleTenants(db, authz, p);
    if (v === "all") return undefined;
    return v.length ? inArray(replicationPolicies.tenantId, v) : null;
  };
  const load = async (p: Principal, id: string) => {
    const vis = await visibility(p);
    if (vis === null) throw notFound("Policy not found");
    const [row] = await db
      .select()
      .from(replicationPolicies)
      .where(and(eq(replicationPolicies.id, uuidParam(id, "Policy not found")), vis));
    if (!row) throw notFound("Policy not found");
    return row;
  };
  const manage = async (p: Principal, id: string) => {
    const row = await load(p, id);
    if (!(await platformCan(authz, p, "operator")) && !(row.tenantId && (await can(authz, p, "admin", `tenant:${row.tenantId}`)))) throw forbidden();
    return row;
  };
  const target = (id: string) => ({ type: "replication_policy", id });

  return new Elysia({ name: "replication" })
    .use(principalContext)
    .get("/api/v1/replication-policies", async ({ principal }) => {
      const vis = await visibility(authed(principal));
      if (vis === null) return [];
      return db.select().from(replicationPolicies).where(vis).orderBy(desc(replicationPolicies.createdAt));
    })
    .post(
      "/api/v1/replication-policies",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const row = await audited(db, { principal: p, request }, "replication.create", (r) => r && target(r.id), async () => {
          const inst = await visibleInventoryInstance(db, acl, p, body.instanceId);
          const to = await resolveTarget(db, acl, p, inst, { targetClusterId: body.targetClusterId, mode: "copy", targetProject: body.targetProject });
          try {
            const [r] = await db
              .insert(replicationPolicies)
              .values({
                tenantId: inst.tenantId,
                sourceClusterId: inst.clusterId,
                sourceProject: inst.project,
                instanceName: inst.name,
                targetClusterId: to.dst.id,
                targetProject: to.targetProject,
                targetName: body.targetName ?? inst.name,
                intervalS: body.intervalS ?? 3600,
                createdBy: `${p.kind}:${p.id}`,
              })
              .returning();
            return r!;
          } catch (e) {
            if (uniqueViolation(e)) throw new ApiError(409, "conflict", "This instance already replicates to that cluster");
            throw e;
          }
        });
        return created(set, row);
      },
      {
        body: t.Object({
          instanceId: t.String(),
          targetClusterId: t.String(),
          targetName: t.Optional(t.String({ pattern: NAME })),
          /** Platform operators only. */
          targetProject: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
          intervalS: t.Optional(Interval),
        }),
      },
    )
    .get("/api/v1/replication-policies/:id", async ({ principal, params }) => load(authed(principal), params.id))
    .patch(
      "/api/v1/replication-policies/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "replication.update", target(params.id), async () => {
          await manage(p, params.id);
          const [row] = await db.update(replicationPolicies).set(body).where(eq(replicationPolicies.id, params.id)).returning();
          return row!;
        });
      },
      { body: t.Object({ enabled: t.Optional(t.Boolean()), intervalS: t.Optional(Interval) }) },
    )
    .delete("/api/v1/replication-policies/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      // The replica stays: it is an instance like any other once its policy is gone.
      await audited(db, { principal: p, request }, "replication.delete", target(params.id), async () => {
        await manage(p, params.id);
        await db.delete(replicationPolicies).where(eq(replicationPolicies.id, params.id));
      });
      return noContent(set);
    })
    .post("/api/v1/replication-policies/:id/run", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      const job = await audited(db, { principal: p, request }, "replication.run", target(params.id), async () => {
        const row = await manage(p, params.id);
        if (row.state !== "active") throw new ApiError(409, "conflict", "This policy has failed over");
        const j = await enqueueJob(db, { type: "replicate", payload: { policyId: row.id }, actor: { type: p.kind, id: p.id }, tenantId: row.tenantId, clusterIds: [row.sourceClusterId, row.targetClusterId], instanceKey: policyInstanceKey(row) });
        await db.update(replicationPolicies).set({ lastRunAt: new Date(), lastJobId: j.id }).where(eq(replicationPolicies.id, row.id));
        return j;
      });
      set.status = 202;
      return job;
    })
    .post(
      "/api/v1/replication-policies/:id/failover",
      async ({ principal, request, params, body, set }) => {
        const p = authed(principal);
        const job = await audited(db, { principal: p, request }, "replication.failover", target(params.id), async () => {
          const row = await manage(p, params.id);
          if (row.state !== "active") throw new ApiError(409, "conflict", "This policy has already failed over");
          // Not keyed on the source instance: a stuck run against a lost source must not hold up the failover.
          return enqueueJob(db, { type: "failover", payload: { policyId: row.id, stopSource: body.stopSource }, actor: { type: p.kind, id: p.id }, tenantId: row.tenantId, clusterIds: [row.sourceClusterId, row.targetClusterId] });
        });
        set.status = 202;
        return job;
      },
      { body: t.Object({ stopSource: t.Boolean() }) },
    );
}
