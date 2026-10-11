import { Elysia } from "elysia";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterMembers, clusters, placements, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { needVisible, notFound } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { sumUsage } from "../tenants/quota.ts";
import type { Candidate } from "../tenants/placement.ts";
import { uuidParam } from "./common.ts";

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

  return new Elysia().use(principalContext).get("/api/v1/tenants/:id/usage", async ({ principal, params }) => {
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
