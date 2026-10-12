import { Elysia, t } from "elysia";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterMembers, clusters, instances, jobs, placements, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { can, forbidden, needVisible, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { exceeds, sumUsage, type Usage } from "../tenants/quota.ts";
import { type Candidate, choose } from "../tenants/placement.ts";
import type { CreatePayload } from "../tenants/create-job.ts";
import { audited, uuidParam } from "./common.ts";

const GiB = 1024 ** 3;
const NAME = "^[a-zA-Z][a-zA-Z0-9-]{0,62}$";
/** An image alias on the image server: "debian/12", "ubuntu/24.04/cloud". */
const ALIAS = "^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*){0,3}$";

/** The images offered by default (images.linuxcontainers.org aliases); any alias is accepted. */
export const IMAGES = [
  { alias: "debian/12", label: "Debian 12", vm: true },
  { alias: "debian/13", label: "Debian 13", vm: true },
  { alias: "ubuntu/24.04", label: "Ubuntu 24.04 LTS", vm: true },
  { alias: "ubuntu/22.04", label: "Ubuntu 22.04 LTS", vm: true },
  { alias: "rockylinux/9", label: "Rocky Linux 9", vm: true },
  { alias: "fedora/42", label: "Fedora 42", vm: true },
  { alias: "archlinux", label: "Arch Linux", vm: true },
  { alias: "alpine/3.22", label: "Alpine 3.22", vm: false },
];

/** Resources asked for by creates not finished yet: they count against the quota until their usage is recorded. */
export async function pendingOf(db: Db, tenantId: string): Promise<Usage> {
  const rows = await db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), inArray(jobs.type, ["create", "k8s-create"]), inArray(jobs.state, ["queued", "running"])));
  return sumUsage(rows.map(({ payload }) => {
    // A Kubernetes create carries its nodes' and load balancer's total.
    if (payload.usage) return payload.usage as Usage;
    const p = payload as unknown as CreatePayload;
    return { instances: 1, cpu: p.cpu, memory: p.memory, disk: p.disk };
  }));
}

/** A tenant's placements with what the inventory knows of each cluster: placement candidates. */
export async function candidatesOf(db: Db, tenantId: string): Promise<Candidate[]> {
  const rows = await db
    .select({
      clusterId: clusters.id,
      clusterName: clusters.name,
      project: placements.project,
      placementStatus: placements.status,
      clusterStatus: clusters.status,
      labels: clusters.labels,
      memoryTotal: sql<number>`coalesce(sum(${clusterMembers.memoryTotal}) filter (where ${clusterMembers.status} = 'Online'), 0)`.mapWith(Number),
      memoryUsed: sql<number>`coalesce(sum(${clusterMembers.memoryUsed}) filter (where ${clusterMembers.status} = 'Online'), 0)`.mapWith(Number),
    })
    .from(placements)
    .innerJoin(clusters, eq(clusters.id, placements.clusterId))
    .leftJoin(clusterMembers, eq(clusterMembers.clusterId, clusters.id))
    .where(eq(placements.tenantId, tenantId))
    .groupBy(clusters.id, clusters.name, placements.project, placements.status, clusters.status, clusters.labels);
  return rows;
}

/** The tenant cloud (P9): usage against the quota across clusters. */
export function tenantCloudRoutes({ db, authz }: { db: Db; authz: Authz }) {
  const loadTenant = async (p: Principal, id: string, relation: string) => {
    uuidParam(id);
    await needVisible(authz, p, "viewer", relation, `tenant:${id}`);
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!row) throw notFound();
    return row;
  };

  return new Elysia()
    .use(principalContext)
    .get("/api/v1/images", ({ principal }) => {
      authed(principal);
      return IMAGES;
    })
    .post(
      "/api/v1/tenants/:id/instances",
      async ({ principal, request, params, body, set }) => {
        const p = authed(principal);
        uuidParam(params.id);
        await needVisible(authz, p, "viewer", "viewer", `tenant:${params.id}`);
        if (!(await can(authz, p, "member", `tenant:${params.id}`)) && !(await platformCan(authz, p, "operator"))) throw forbidden();
        const req: Usage = { instances: 1, cpu: body.cpu, memory: Math.round(body.memoryGiB * 1024) * 1024 ** 2, disk: body.diskGiB * GiB };
        const job = await audited(db, { principal: p, request }, "instance.create", { type: "tenant", id: params.id }, () =>
          // One quota decision at a time per tenant: usage, pending creates and this one, then the job.
          db.transaction(async (tx) => {
            const txDb = tx as unknown as Db;
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-create:${params.id}`}))`);
            const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, params.id));
            if (!tenant) throw notFound();
            const placed = await tx.select({ usage: placements.usage }).from(placements).where(eq(placements.tenantId, tenant.id));
            const used = sumUsage([...placed.map((x) => x.usage), await pendingOf(txDb, tenant.id)]);
            const over = exceeds(tenant.quotas, used, req);
            if (over.length) throw new ApiError(409, "quota_exceeded", `Over the tenant's quota: ${over.join(", ")}`);
            const where = choose(await candidatesOf(txDb, tenant.id), { memory: req.memory }, { clusterId: body.clusterId, labels: body.labels });
            if (!where.ok) throw new ApiError(409, "no_placement", where.reason);
            const { clusterId, clusterName, project } = where.pick;
            const [taken] = await tx
              .select({ id: instances.id })
              .from(instances)
              .where(and(eq(instances.clusterId, clusterId), eq(instances.project, project), eq(instances.name, body.name)));
            if (taken) throw new ApiError(409, "conflict", `An instance named "${body.name}" already exists in ${project} on ${clusterName}`);
            const payload: CreatePayload = { tenantId: tenant.id, clusterId, project, name: body.name, image: body.image, type: body.type ?? "container", cpu: body.cpu, memory: req.memory, disk: req.disk, start: body.start ?? true };
            return enqueueJob(txDb, {
              type: "create",
              payload: payload as unknown as Record<string, unknown>,
              actor: { type: p.kind, id: p.id },
              tenantId: tenant.id,
              clusterIds: [clusterId],
              instanceKey: `${clusterId}/${project}/${body.name}`,
            });
          }),
        );
        set.status = 202;
        return job;
      },
      {
        body: t.Object({
          name: t.String({ pattern: NAME }),
          image: t.String({ pattern: ALIAS, maxLength: 100 }),
          type: t.Optional(t.Union([t.Literal("container"), t.Literal("virtual-machine")])),
          cpu: t.Integer({ minimum: 1, maximum: 64 }),
          memoryGiB: t.Number({ minimum: 0.125, maximum: 1024 }),
          diskGiB: t.Integer({ minimum: 1, maximum: 4096 }),
          clusterId: t.Optional(t.String({ format: "uuid" })),
          labels: t.Optional(t.Record(t.String({ maxLength: 63 }), t.String({ maxLength: 63 }))),
          start: t.Optional(t.Boolean()),
        }),
      },
    )
    .get("/api/v1/tenants/:id/usage", async ({ principal, params }) => {
    const t = await loadTenant(authed(principal), params.id, "viewer");
    const rows = await db
      .select({ clusterId: placements.clusterId, clusterName: clusters.name, project: placements.project, status: placements.status, usage: placements.usage, limits: placements.limits })
      .from(placements)
      .innerJoin(clusters, eq(clusters.id, placements.clusterId))
      .where(eq(placements.tenantId, t.id))
      .orderBy(clusters.name);
    return { quota: t.quotas, used: sumUsage(rows.map((r) => r.usage)), clusters: rows };
  });
}
