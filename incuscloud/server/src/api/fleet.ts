import { Elysia, t } from "elysia";
import { and, asc, eq, gte, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterMembers, clusters, instances, metricsSamples, networks, placements, storagePools, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { needPriv, notFound } from "../authz/guards.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { uuidParam } from "./common.ts";

const HOUR = 3_600_000;

/** `\`, `%` and `_` match themselves in LIKE. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const instanceColumns = {
  id: instances.id,
  clusterId: instances.clusterId,
  clusterName: clusters.name,
  project: instances.project,
  name: instances.name,
  tenantId: placements.tenantId,
  tenantSlug: tenants.slug,
  type: instances.type,
  status: instances.status,
  location: instances.location,
  description: instances.description,
  architecture: instances.architecture,
  createdAt: instances.createdAtIncus,
  imageOs: instances.imageOs,
  imageRelease: instances.imageRelease,
  limitsCpu: instances.limitsCpu,
  limitsMemory: instances.limitsMemory,
  cpuCores: instances.cpuCores,
  memoryUsed: instances.memoryUsed,
  memoryTotal: instances.memoryTotal,
  diskUsed: instances.diskUsed,
  netRxBps: instances.netRxBps,
  netTxBps: instances.netTxBps,
  addresses: instances.addresses,
  seenAt: instances.seenAt,
  inventoryAt: clusters.inventoryAt,
};

// Instances join their cluster and, through placements, their tenant.
const ON = {
  cluster: eq(clusters.id, instances.clusterId),
  placement: and(eq(placements.clusterId, instances.clusterId), eq(placements.project, instances.project)),
  tenant: eq(tenants.id, placements.tenantId),
};
const fromInstances = (db: Db) => db.select(instanceColumns).from(instances).innerJoin(clusters, ON.cluster).leftJoin(placements, ON.placement).leftJoin(tenants, ON.tenant);

/** The instances a caller may see, as a condition over instances joined with clusters; null when none. */
export async function visibility(acl: Acl, p: Principal, privilege: Privilege = "instance.view"): Promise<SQL | null> {
  const s = await acl.instanceScope(p, privilege);
  const project = sql`${clusters.name} || '/' || ${instances.project}`;
  const one = sql`${clusters.name} || '/' || ${instances.project} || '/' || ${instances.name}`;
  const whole = s.projects.length ? and(inArray(project, s.projects), s.exclude.length ? notInArray(one, s.exclude) : undefined) : undefined;
  const single = s.include.length ? inArray(one, s.include) : undefined;
  return whole && single ? or(whole, single)! : (whole ?? single ?? null);
}


const hoursQuery = t.Object({ hours: t.Optional(t.Numeric({ minimum: 1, maximum: 168 })) });
const since = (hours = 24) => new Date(Date.now() - hours * HOUR);
const sampleColumns = { at: metricsSamples.at, cpuCores: metricsSamples.cpuCores, memoryUsed: metricsSamples.memoryUsed, netRxBps: metricsSamples.netRxBps, netTxBps: metricsSamples.netTxBps, load1: metricsSamples.load1 };
const int = (x: SQL) => sql<number>`cast(${x} as bigint)`.mapWith(Number);

/** Fleet inventory and metrics (P5): a global instance search; cluster capacity for platform viewers. */
export function fleetRoutes({ db, authz, acl }: { db: Db; authz: Authz; acl: Acl }) {
  /** A cluster's inventory and member metrics: `cluster.view` on it. */
  const viewCluster = async (p: Principal, id: string) => {
    const c = await loadCluster(id);
    await needPriv(acl, p, "cluster.view", `/clusters/${c.name}`, "Cluster not found");
    return c;
  };
  const visibleInstance = async (p: Principal, id: string) => {
    const vis = await visibility(acl, p);
    if (vis === null) throw notFound("Instance not found");
    const [row] = await fromInstances(db).where(and(eq(instances.id, uuidParam(id, "Instance not found")), vis));
    if (!row) throw notFound("Instance not found");
    return row;
  };
  const loadCluster = async (id: string) => {
    const [row] = await db.select().from(clusters).where(eq(clusters.id, uuidParam(id, "Cluster not found")));
    if (!row) throw notFound("Cluster not found");
    return row;
  };

  return new Elysia({ name: "fleet" })
    .use(principalContext)
    .get(
      "/api/v1/instances",
      async ({ principal, query }) => {
        const p = authed(principal);
        const vis = await visibility(acl, p);
        if (vis === null) return { items: [], total: 0 };
        const where: Array<SQL | undefined> = [vis];
        if (query.cluster) where.push(eq(instances.clusterId, uuidParam(query.cluster)));
        if (query.tenant) where.push(eq(placements.tenantId, uuidParam(query.tenant)));
        if (query.status) where.push(eq(instances.status, query.status));
        if (query.type) where.push(eq(instances.type, query.type));
        for (const term of (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
          where.push(sql`${instances.search} like ${`%${likeEscape(term)}%`} escape '\\'`);
        }
        const cond = and(...where);
        const items = await fromInstances(db)
          .where(cond)
          .orderBy(asc(clusters.name), asc(instances.project), asc(instances.name))
          .limit(query.limit ?? 100)
          .offset(query.offset ?? 0);
        const [count] = await db.select({ n: int(sql`count(*)`) }).from(instances).innerJoin(clusters, ON.cluster).leftJoin(placements, ON.placement).where(cond);
        return { items, total: count?.n ?? 0 };
      },
      {
        query: t.Object({
          q: t.Optional(t.String({ maxLength: 200 })),
          cluster: t.Optional(t.String()),
          tenant: t.Optional(t.String()),
          status: t.Optional(t.String()),
          type: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
          offset: t.Optional(t.Numeric({ minimum: 0 })),
        }),
      },
    )
    .get("/api/v1/instances/:id", async ({ principal, params }) => visibleInstance(authed(principal), params.id))
    .get(
      "/api/v1/instances/:id/metrics",
      async ({ principal, params, query }) => {
        const row = await visibleInstance(authed(principal), params.id);
        const { load1: _, ...cols } = sampleColumns;
        const samples = await db
          .select(cols)
          .from(metricsSamples)
          .where(and(eq(metricsSamples.kind, "instance"), eq(metricsSamples.ref, row.id), gte(metricsSamples.at, since(query.hours))))
          .orderBy(asc(metricsSamples.at));
        return { samples };
      },
      { query: hoursQuery },
    )
    .get("/api/v1/clusters/:id/inventory", async ({ principal, params }) => {
      const c = await viewCluster(authed(principal), params.id);
      const [members, pools, nets, [counts]] = await Promise.all([
        db.select().from(clusterMembers).where(eq(clusterMembers.clusterId, c.id)).orderBy(asc(clusterMembers.name)),
        db.select().from(storagePools).where(eq(storagePools.clusterId, c.id)).orderBy(asc(storagePools.name), asc(storagePools.member)),
        db.select().from(networks).where(eq(networks.clusterId, c.id)).orderBy(asc(networks.project), asc(networks.name)),
        db
          .select({ total: int(sql`count(*)`), running: int(sql`count(*) filter (where ${instances.status} = 'Running')`) })
          .from(instances)
          .where(eq(instances.clusterId, c.id)),
      ]);
      return { inventoryAt: c.inventoryAt, inventoryError: c.inventoryError, members, pools, networks: nets, instances: counts };
    })
    .get(
      "/api/v1/clusters/:id/metrics",
      async ({ principal, params, query }) => {
        const c = await viewCluster(authed(principal), params.id);
        const rows = await db
          .select({ ref: metricsSamples.ref, ...sampleColumns })
          .from(metricsSamples)
          .where(and(eq(metricsSamples.clusterId, c.id), eq(metricsSamples.kind, "member"), gte(metricsSamples.at, since(query.hours))))
          .orderBy(asc(metricsSamples.at));
        const members: Record<string, Array<{ at: Date; memoryUsed: number | null; load1: number | null }>> = {};
        for (const { ref, at, memoryUsed, load1 } of rows) (members[ref] ??= []).push({ at, memoryUsed, load1 });
        return { members };
      },
      { query: hoursQuery },
    )
    .get("/api/v1/fleet/summary", async ({ principal }) => {
      const p = authed(principal);
      const vis = await visibility(acl, p);
      const byStatus: Record<string, number> = {};
      let total = 0;
      if (vis !== null) {
        const rows = await db
          .select({ status: instances.status, n: int(sql`count(*)`) })
          .from(instances)
          .innerJoin(clusters, ON.cluster)
          .where(vis)
          .groupBy(instances.status);
        for (const r of rows) {
          byStatus[r.status] = r.n;
          total += r.n;
        }
      }
      const summary: { instances: { total: number; byStatus: Record<string, number> }; clusters?: unknown[] } = { instances: { total, byStatus } };
      // Capacity is the platform's: for those who see every cluster.
      if (!(await acl.can(p, "cluster.view", "/"))) return summary;

      const sum = (x: SQL | typeof clusterMembers.cpuThreads) => int(sql`coalesce(sum(${x}), 0)`);
      const [list, inst, mem, pool] = await Promise.all([
        db.select({ id: clusters.id, name: clusters.name, status: clusters.status, inventoryAt: clusters.inventoryAt, inventoryError: clusters.inventoryError }).from(clusters).orderBy(asc(clusters.name)),
        db
          .select({ id: instances.clusterId, instances: int(sql`count(*)`), running: int(sql`count(*) filter (where ${instances.status} = 'Running')`) })
          .from(instances)
          .groupBy(instances.clusterId),
        db
          .select({ id: clusterMembers.clusterId, cpuThreads: sum(clusterMembers.cpuThreads), memoryTotal: sum(sql`${clusterMembers.memoryTotal}`), memoryUsed: sum(sql`${clusterMembers.memoryUsed}`) })
          .from(clusterMembers)
          .groupBy(clusterMembers.clusterId),
        db
          .select({ id: storagePools.clusterId, storageTotal: sum(sql`${storagePools.spaceTotal}`), storageUsed: sum(sql`${storagePools.spaceUsed}`) })
          .from(storagePools)
          .groupBy(storagePools.clusterId),
      ]);
      const by = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
      const [bi, bm, bp] = [by(inst), by(mem), by(pool)];
      summary.clusters = list.map((c) => ({
        ...c,
        instances: bi.get(c.id)?.instances ?? 0,
        running: bi.get(c.id)?.running ?? 0,
        cpuThreads: bm.get(c.id)?.cpuThreads ?? 0,
        memoryTotal: bm.get(c.id)?.memoryTotal ?? 0,
        memoryUsed: bm.get(c.id)?.memoryUsed ?? 0,
        storageTotal: bp.get(c.id)?.storageTotal ?? 0,
        storageUsed: bp.get(c.id)?.storageUsed ?? 0,
      }));
      return summary;
    });
}
