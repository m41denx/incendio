import { Elysia, t } from "elysia";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { balancingPolicies, clusterMembers, clusters, instances, placements, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { forbidden, needPriv, notFound } from "../authz/guards.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { clusterClient, type ClusterRow } from "../clusters/enroll.ts";
import type { IncusAdminClient } from "../incus/admin-client.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { EVACUATE_MODES, planCluster, policyOf, type MemberPayload } from "../balancing/jobs.ts";
import { DEFAULT_POLICY } from "../balancing/model.ts";
import { suggest } from "../balancing/suggest.ts";
import { audited, filterAsync, uuidParam } from "./common.ts";

export type ClientOf = (row: ClusterRow) => Pick<IncusAdminClient, "request">;

/** Percentage points between a tenant's hottest and coolest cluster before suggesting moves. */
const SUGGEST_THRESHOLD = 20;

const PolicyFields = {
  method: t.Union([t.Literal("memory"), t.Literal("cpu"), t.Literal("disk")]),
  mode: t.Union([t.Literal("used"), t.Literal("assigned")]),
  balanciness: t.Integer({ minimum: 1, maximum: 100 }),
  maxMoves: t.Integer({ minimum: 1, maximum: 50 }),
  allowRestart: t.Boolean(),
  excludeMembers: t.Array(t.String({ minLength: 1, maxLength: 255 }), { maxItems: 100 }),
  excludeProjects: t.Array(t.String({ minLength: 1, maxLength: 63 }), { maxItems: 100 }),
};

/** Balancing (P8): per-cluster policies, plans and runs, member maintenance — platform staff; cross-cluster suggestions — anyone, for their tenants. */
export function balancingRoutes({ db, authz, acl, secretKey, clientOf }: { db: Db; authz: Authz; acl: Acl; secretKey: Buffer; clientOf?: ClientOf }) {
  const client = clientOf ?? ((row: ClusterRow) => clusterClient({ secretKey }, row));
  /** The cluster, if the caller sees it (404) and holds `privilege` on it (403). */
  const loadCluster = async (p: Principal, id: string, privilege: Privilege) => {
    const [row] = await db.select().from(clusters).where(eq(clusters.id, uuidParam(id, "Cluster not found")));
    if (!row) throw notFound("Cluster not found");
    await needPriv(acl, p, privilege, `/clusters/${row.name}`, "Cluster not found");
    return row;
  };
  const policyView = async (clusterId: string) => {
    const [row] = await db.select().from(balancingPolicies).where(eq(balancingPolicies.clusterId, clusterId));
    return row ?? { clusterId, enabled: false, intervalS: 3600, ...DEFAULT_POLICY, lastRunAt: null, lastSuccessAt: null, lastError: "", lastJobId: null, updatedBy: "", updatedAt: null };
  };
  const memberJob = async (p: Principal, request: Request, clusterId: string, member: string, type: "evacuate" | "restore-member", mode?: MemberPayload["mode"]) => {
    const [c] = await db.select().from(clusters).where(eq(clusters.id, uuidParam(clusterId, "Cluster not found")));
    if (!c || !(await acl.sees(p, `/clusters/${c.name}`))) throw notFound("Cluster not found");
    const [m] = await db
      .select()
      .from(clusterMembers)
      .where(and(eq(clusterMembers.clusterId, c.id), eq(clusterMembers.name, member)));
    if (!m) throw notFound("Member not found");
    // node.maintain on the cluster, or on one of the member's cluster groups (a Group owner's members).
    const paths = [`/clusters/${c.name}`, ...(m.groups ?? []).map((g) => `/clusters/${c.name}/groups/${g}`)];
    if (!(await Promise.all(paths.map((x) => acl.can(p, "node.maintain", x)))).some(Boolean)) throw forbidden();
    const payload: MemberPayload = { clusterId: c.id, member, ...(mode && { mode }) };
    return audited(db, { principal: p, request }, type === "evacuate" ? "cluster_member.evacuate" : "cluster_member.restore", { type: "cluster", id: c.id }, () =>
      enqueueJob(db, { type, payload: payload as unknown as Record<string, unknown>, actor: { type: p.kind, id: p.id }, tenantId: null, clusterIds: [c.id], instanceKey: `member:${c.id}/${member}` }),
    );
  };

  return (
    new Elysia()
      .use(principalContext)
      .get("/api/v1/clusters/:id/balancing", async ({ principal, params }) => {
        return policyView((await loadCluster(authed(principal), params.id, "cluster.view")).id);
      })
      .put(
        "/api/v1/clusters/:id/balancing",
        async ({ principal, request, params, body }) => {
          const p = authed(principal);
          const c = await loadCluster(p, params.id, "cluster.configure");
          return audited(db, { principal: p, request }, "balancing_policy.update", { type: "cluster", id: c.id }, async () => {
            const v = { ...body, updatedBy: `${p.kind}:${p.id}`, updatedAt: new Date() };
            const [row] = await db
              .insert(balancingPolicies)
              .values({ clusterId: c.id, ...v })
              .onConflictDoUpdate({ target: balancingPolicies.clusterId, set: v })
              .returning();
            return row!;
          });
        },
        { body: t.Object({ enabled: t.Boolean(), intervalS: t.Integer({ minimum: 300, maximum: 86400 }), ...PolicyFields }) },
      )
      .post(
        "/api/v1/clusters/:id/balancing/plan",
        async ({ principal, params, body }) => {
          const c = await loadCluster(authed(principal), params.id, "cluster.configure");
          const policy = { ...(await policyOf(db, c.id)), ...body };
          return (await planCluster(db, client(c), c.id, policy)).plan;
        },
        { body: t.Partial(t.Object(PolicyFields)) },
      )
      .post("/api/v1/clusters/:id/balancing/run", async ({ principal, request, params, set }) => {
        const p = authed(principal);
        const c = await loadCluster(p, params.id, "cluster.configure");
        const job = await audited(db, { principal: p, request }, "balancing.run", { type: "cluster", id: c.id }, () =>
          enqueueJob(db, { type: "rebalance", payload: { clusterId: c.id }, actor: { type: p.kind, id: p.id }, tenantId: null, clusterIds: [c.id], instanceKey: `rebalance:${c.id}` }),
        );
        set.status = 202;
        return job;
      })
      .post(
        "/api/v1/clusters/:id/members/:name/evacuate",
        async ({ principal, request, params, body, set }) => {
          const job = await memberJob(authed(principal), request, params.id, params.name, "evacuate", body?.mode);
          set.status = 202;
          return job;
        },
        { body: t.Optional(t.Object({ mode: t.Optional(t.Union(EVACUATE_MODES.map((m) => t.Literal(m)))) })) },
      )
      .post("/api/v1/clusters/:id/members/:name/restore", async ({ principal, request, params, set }) => {
        const job = await memberJob(authed(principal), request, params.id, params.name, "restore-member");
        set.status = 202;
        return job;
      })
      .get("/api/v1/balancing/suggestions", async ({ principal }) => {
        const p = authed(principal);
        const all = await db
          .select({ tenantId: placements.tenantId, tenantSlug: tenants.slug, clusterId: placements.clusterId, project: placements.project })
          .from(placements)
          .innerJoin(tenants, eq(tenants.id, placements.tenantId))
          .where(eq(placements.status, "ready"));
        const places = await filterAsync(all, (x) => acl.can(p, "tenant.view", `/tenants/${x.tenantSlug}`));
        if (!places.length) return [];
        const clusterIds = [...new Set(places.map((p) => p.clusterId))];
        const loads = await db
          .select({ id: clusters.id, name: clusters.name, memoryTotal: sql<number>`coalesce(sum(${clusterMembers.memoryTotal}), 0)`.mapWith(Number), memoryUsed: sql<number>`coalesce(sum(${clusterMembers.memoryUsed}), 0)`.mapWith(Number) })
          .from(clusters)
          .leftJoin(clusterMembers, and(eq(clusterMembers.clusterId, clusters.id), eq(clusterMembers.status, "Online")))
          .where(inArray(clusters.id, clusterIds))
          .groupBy(clusters.id, clusters.name);
        const inst = await db
          .select({ id: instances.id, clusterId: instances.clusterId, project: instances.project, name: instances.name, status: instances.status, memoryUsed: instances.memoryUsed })
          .from(instances)
          .where(and(inArray(instances.clusterId, clusterIds), inArray(instances.project, [...new Set(places.map((p) => p.project))]), eq(instances.status, "Running")));
        return suggest({ threshold: SUGGEST_THRESHOLD, clusters: loads, placements: places, instances: inst });
      })
  );
}
