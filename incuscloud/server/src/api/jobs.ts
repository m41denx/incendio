import { Elysia, t } from "elysia";
import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jobs } from "../db/schema.ts";
import type { Acl } from "../acl/acl.ts";
import { forbidden, notFound } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { audited, uuidParam } from "./common.ts";

/**
 * Jobs (P6): a caller sees their own, those on instances they may view, their
 * tenants' jobs on no instance (with instance.view on the whole tenant, so not
 * a User's), and the jobs of clusters they may view that belong to no tenant.
 */
export function jobsRoutes({ db, acl }: { db: Db; acl: Acl }) {
  const visibility = async (p: Principal): Promise<SQL> => {
    const own = and(eq(jobs.actorType, p.kind), eq(jobs.actorId, p.id))!;
    const [scope, ids] = await Promise.all([acl.instanceScope(p), acl.lookup()]);
    // Scope keys name clusters; job keys carry their ids.
    const idOf = new Map([...ids.clusterNames].map(([id, name]) => [name, id]));
    const byId = (k: string) => {
      const [cluster, ...rest] = k.split("/");
      const id = idOf.get(cluster!);
      return id ? [id, ...rest].join("/") : null;
    };
    const keys = (list: string[]) => list.map(byId).filter((k): k is string => !!k);
    const projects = keys(scope.projects).map((k) => sql`starts_with(${jobs.instanceKey}, ${`${k}/`})`);
    const exclude = keys(scope.exclude);
    const include = keys(scope.include);
    const tenantIds: string[] = [];
    for (const [id, slug] of ids.tenantSlugs) if (await acl.can(p, "instance.view", `/tenants/${slug}`)) tenantIds.push(id);
    const clusterIds: string[] = [];
    for (const [id, name] of ids.clusterNames) if (await acl.can(p, "cluster.view", `/clusters/${name}`)) clusterIds.push(id);
    return or(
      own,
      projects.length ? and(or(...projects), exclude.length ? notInArray(jobs.instanceKey, exclude) : undefined) : undefined,
      include.length ? inArray(jobs.instanceKey, include) : undefined,
      tenantIds.length ? and(isNull(jobs.instanceKey), inArray(jobs.tenantId, tenantIds)) : undefined,
      // Platform staff: the platform's own jobs, on no cluster too.
      (await acl.can(p, "cluster.view", "/")) ? isNull(jobs.tenantId) : undefined,
      clusterIds.length ? and(isNull(jobs.tenantId), sql`jsonb_exists_any(${jobs.clusterIds}, array[${sql.join(clusterIds.map((id) => sql`${id}`), sql`, `)}]::text[])`) : undefined,
    )!;
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
        const ids = await acl.lookup();
        const slug = job.tenantId && ids.tenantSlugs.get(job.tenantId);
        const configures = async () => {
          for (const id of job.clusterIds) if (await acl.can(p, "cluster.configure", `/clusters/${ids.clusterNames.get(id)}`)) return true;
          return false;
        };
        const allowed = (job.actorType === p.kind && job.actorId === p.id) || (slug && (await acl.can(p, "tenant.manage", `/tenants/${slug}`))) || (await configures());
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
