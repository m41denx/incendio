import { Elysia, t } from "elysia";
import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jobs } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { can, forbidden, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { audited, uuidParam, visibleTenants } from "./common.ts";

/** Jobs (P6): platform viewers see all; others their tenants' jobs and their own. */
export function jobsRoutes({ db, authz }: { db: Db; authz: Authz }) {
  const visibility = async (p: Principal): Promise<SQL | undefined> => {
    const v = await visibleTenants(db, authz, p);
    if (v === "all") return undefined;
    const own = and(eq(jobs.actorType, p.kind), eq(jobs.actorId, p.id));
    return v.length ? or(own, inArray(jobs.tenantId, v)) : own;
  };
  const load = async (p: Principal, id: string) => {
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, uuidParam(id, "Job not found")), await visibility(p)));
    if (!row) throw notFound("Job not found");
    return row;
  };

  return new Elysia({ name: "jobs" })
    .use(principalContext)
    .get(
      "/api/v1/jobs",
      async ({ principal, query }) => {
        const p = authed(principal);
        const where: Array<SQL | undefined> = [await visibility(p)];
        if (query.state) where.push(eq(jobs.state, query.state as never));
        if (query.type) where.push(eq(jobs.type, query.type));
        if (query.tenant) where.push(eq(jobs.tenantId, uuidParam(query.tenant)));
        if (query.before) where.push(lt(jobs.createdAt, new Date(query.before)));
        return db
          .select()
          .from(jobs)
          .where(and(...where))
          .orderBy(desc(jobs.createdAt), desc(jobs.id))
          .limit(query.limit ?? 100);
      },
      {
        query: t.Object({
          state: t.Optional(t.String()),
          type: t.Optional(t.String()),
          tenant: t.Optional(t.String()),
          before: t.Optional(t.String({ format: "date-time" })),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
        }),
      },
    )
    .get("/api/v1/jobs/:id", async ({ principal, params }) => load(authed(principal), params.id))
    .post("/api/v1/jobs/:id/cancel", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      const row = await audited(db, { principal: p, request }, "job.cancel", { type: "job", id: params.id }, async () => {
        const job = await load(p, params.id);
        const allowed = (job.actorType === p.kind && job.actorId === p.id) || (await platformCan(authz, p, "operator")) || (job.tenantId && (await can(authz, p, "admin", `tenant:${job.tenantId}`)));
        if (!allowed) throw forbidden();
        // A queued job is cancelled now; a running one when its handler sees the request.
        const [queued] = await db
          .update(jobs)
          .set({ state: "cancelled", cancelRequested: true, finishedAt: new Date() })
          .where(and(eq(jobs.id, job.id), eq(jobs.state, "queued")))
          .returning();
        if (queued) return queued;
        const [running] = await db
          .update(jobs)
          .set({ cancelRequested: true })
          .where(and(eq(jobs.id, job.id), eq(jobs.state, "running")))
          .returning();
        if (running) return running;
        throw new ApiError(409, "finished", "The job has already finished");
      });
      set.status = 202;
      return row;
    });
}
