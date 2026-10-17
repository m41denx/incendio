import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, instances, placements } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { forbidden, notFound } from "../authz/guards.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { clusterClient, type ClusterRow } from "../clusters/enroll.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { sourceFacts, targetFacts } from "../mobility/facts.ts";
import { preflight, type SourceInstance, type TargetFacts } from "../mobility/preflight.ts";
import type { MigratePayload } from "../mobility/migrate-job.ts";
import { audited, uuidParam } from "./common.ts";

/** Reads what pre-flight needs from both clusters (replaced in tests). */
export type Inspect = (src: ClusterRow, dst: ClusterRow, sourceProject: string, name: string, targetProject: string) => Promise<{ source: SourceInstance; target: TargetFacts }>;

export const liveInspect =
  (secretKey: Buffer): Inspect =>
  async (src, dst, sourceProject, name, targetProject) => {
    const [source, target] = await Promise.all([sourceFacts(clusterClient({ secretKey }, src), sourceProject, name), targetFacts(clusterClient({ secretKey }, dst), targetProject)]);
    return { source, target };
  };

const NAME = "^[a-zA-Z][a-zA-Z0-9-]{0,62}$";
const MigrationBody = t.Object({
  targetClusterId: t.String(),
  mode: t.Union([t.Literal("copy"), t.Literal("move")]),
  live: t.Optional(t.Boolean()),
  targetName: t.Optional(t.String({ pattern: NAME })),
  /** Platform operators only. */
  targetProject: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
  pool: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
  transport: t.Optional(t.Union([t.Literal("auto"), t.Literal("direct"), t.Literal("relay")])),
});
type Body = typeof MigrationBody.static;

/** An instance in the inventory with its tenant (through placements) and permission path, if the caller may see it. */
export async function visibleInventoryInstance(db: Db, acl: Acl, p: Principal, id: string) {
  const [row] = await db
    .select({ id: instances.id, clusterId: instances.clusterId, clusterName: clusters.name, project: instances.project, name: instances.name, tenantId: placements.tenantId })
    .from(instances)
    .innerJoin(clusters, eq(clusters.id, instances.clusterId))
    .leftJoin(placements, and(eq(placements.clusterId, instances.clusterId), eq(placements.project, instances.project)))
    .where(eq(instances.id, uuidParam(id, "Instance not found")));
  const path = row && `/clusters/${row.clusterName}/projects/${row.project}/instances/${row.name}`;
  if (!row || !path || !(await acl.can(p, "instance.view", path))) throw notFound("Instance not found");
  return { ...row, path };
}

/**
 * Where a caller may send an instance (`privilege` on it, instance.relocate
 * for a move between clusters): whoever may create instances anywhere on the
 * target cluster chooses freely (the project they name, else the tenant's
 * placement there, else the same project); others only to the tenant's ready
 * placement there, holding instance.create on it, with the defaults for pool
 * and transport.
 */
export async function resolveTarget(db: Db, acl: Acl, p: Principal, inst: Awaited<ReturnType<typeof visibleInventoryInstance>>, body: Body, privilege: Privilege = "instance.relocate") {
  if (!(await acl.can(p, privilege, inst.path))) throw forbidden();
  const targetClusterId = uuidParam(body.targetClusterId, "Target cluster not found");
  if (targetClusterId === inst.clusterId) throw new ApiError(400, "invalid_request", "The instance is already on that cluster");
  const [dst] = await db.select().from(clusters).where(eq(clusters.id, targetClusterId));
  if (!dst) throw notFound("Target cluster not found");
  if (dst.status === "disabled") throw new ApiError(400, "invalid_request", "The target cluster is disabled");
  const [placement] = inst.tenantId ? await db.select().from(placements).where(and(eq(placements.tenantId, inst.tenantId), eq(placements.clusterId, targetClusterId))) : [];

  if (await acl.can(p, "instance.create", `/clusters/${dst.name}`)) {
    return { dst, targetProject: body.targetProject ?? placement?.project ?? inst.project, pool: body.pool, transport: body.transport ?? "auto" };
  }
  if (placement?.status !== "ready") throw new ApiError(403, "forbidden", "The tenant is not placed on that cluster");
  if (!(await acl.can(p, "instance.create", `/clusters/${dst.name}/projects/${placement.project}`))) throw forbidden();
  if (body.targetProject && body.targetProject !== placement.project) throw forbidden();
  return { dst, targetProject: placement.project, pool: undefined, transport: "auto" as const };
}

/** Cross-cluster migration (P6): pre-flight now, the move itself as a job. */
export function mobilityRoutes({ db, acl, secretKey, inspect }: { db: Db; acl: Acl; secretKey: Buffer; inspect?: Inspect }) {
  const read = inspect ?? liveInspect(secretKey);

  const plan = async (p: Principal, id: string, body: Body) => {
    const inst = await visibleInventoryInstance(db, acl, p, id);
    const target = await resolveTarget(db, acl, p, inst, body);
    const [src] = await db.select().from(clusters).where(eq(clusters.id, inst.clusterId));
    const targetName = body.targetName ?? inst.name;
    const facts = await read(src!, target.dst, inst.project, inst.name, target.targetProject);
    const check = preflight({ ...facts, targetName, mode: body.mode, live: body.live ?? false, pool: target.pool });
    return { inst, target, targetName, check };
  };

  return new Elysia({ name: "mobility" })
    .use(principalContext)
    .post(
      "/api/v1/instances/:id/migrations/preflight",
      async ({ principal, params, body }) => {
        const { check, target, targetName } = await plan(authed(principal), params.id, body);
        return { ok: check.ok, problems: check.problems, warnings: check.warnings, targetProject: target.targetProject, targetName };
      },
      { body: MigrationBody },
    )
    .post(
      "/api/v1/instances/:id/migrations",
      async ({ principal, request, params, body, set }) => {
        const p = authed(principal);
        const job = await audited(db, { principal: p, request }, "instance.migrate", { type: "instance", id: params.id }, async () => {
          const { inst, target, targetName, check } = await plan(p, params.id, body);
          if (!check.ok) throw new ApiError(409, "preflight_failed", `Pre-flight failed: ${check.problems.join("; ")}`);
          const payload: MigratePayload = {
            sourceClusterId: inst.clusterId,
            sourceProject: inst.project,
            name: inst.name,
            targetClusterId: target.dst.id,
            targetProject: target.targetProject,
            targetName,
            mode: body.mode,
            live: body.live ?? false,
            ...(target.pool ? { pool: target.pool } : {}),
            transport: target.transport,
          };
          return enqueueJob(db, {
            type: "migrate",
            payload: payload as unknown as Record<string, unknown>,
            actor: { type: p.kind, id: p.id },
            tenantId: inst.tenantId,
            clusterIds: [inst.clusterId, target.dst.id],
            instanceKey: `${inst.clusterId}/${inst.project}/${inst.name}`,
          });
        });
        set.status = 202;
        return job;
      },
      { body: MigrationBody },
    );
}
