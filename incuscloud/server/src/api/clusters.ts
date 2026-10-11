import { Elysia, t } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, placements, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { tuples } from "../authz/sync.ts";
import { forbidden, needVisible, notFound, platformCan, subject } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { clusterClient, enrollCluster, type ClusterRow } from "../clusters/enroll.ts";
import { fingerprintOf } from "../incus/certs.ts";
import { ApiError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { audited, created, noContent, uuidParam } from "./common.ts";

/** Cluster names are DNS labels: `<name>.<IC_CLUSTER_DOMAIN>` routes API clients (spec D11). */
const NAME = "^[a-z][a-z0-9-]{0,61}[a-z0-9]$";
const Labels = t.Record(t.String({ maxLength: 63 }), t.String({ maxLength: 253 }));

/** What clients may see of a cluster: never its client key or certificate. */
const view = (c: ClusterRow) => ({
  id: c.id,
  name: c.name,
  url: c.url,
  addresses: c.addresses,
  fingerprint: c.fingerprint,
  status: c.status,
  statusMessage: c.statusMessage,
  labels: c.labels,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  lastSeenAt: c.lastSeenAt,
});

/** Cluster registry, enrolment and tenant placement. */
export function clustersRoutes({ db, authz, secretKey }: { db: Db; authz: Authz; secretKey: Buffer }) {
  const load = async (p: Principal, id: string, relation: string) => {
    uuidParam(id);
    await needVisible(authz, p, "can_access", relation, `cluster:${id}`);
    const [row] = await db.select().from(clusters).where(eq(clusters.id, id));
    if (!row) throw notFound();
    return row;
  };
  const needOperator = async (p: Principal) => {
    if (!(await platformCan(authz, p, "operator"))) throw forbidden();
  };

  return new Elysia({ name: "clusters" })
    .use(principalContext)
    .get("/api/v1/clusters", async ({ principal }) => {
      const p = authed(principal);
      if (await platformCan(authz, p, "viewer")) return (await db.select().from(clusters).orderBy(clusters.name)).map(view);
      const ids = (await authz.listObjects(subject(p), "can_access", "cluster")).map((o) => o.slice("cluster:".length));
      return ids.length ? (await db.select().from(clusters).where(inArray(clusters.id, ids)).orderBy(clusters.name)).map(view) : [];
    })
    .post(
      "/api/v1/clusters",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const res = await audited(db, { principal: p, request }, "cluster.enroll", (r) => r && { type: "cluster", id: r.id }, async () => {
          if (!(await platformCan(authz, p, "admin"))) throw forbidden();
          const row = await enrollCluster({ db, secretKey }, { name: body.name, token: body.token, labels: body.labels });
          await authz.write([tuples.cluster(row.id)]);
          return view(row);
        }, (c) => ({ clusterId: c.id, name: c.name, url: c.url }));
        return created(set, res);
      },
      { body: t.Object({ name: t.String({ pattern: NAME }), token: t.String({ minLength: 1, maxLength: 8192 }), labels: t.Optional(Labels) }) },
    )
    .get("/api/v1/clusters/:id", async ({ principal, params }) => view(await load(authed(principal), params.id, "can_access")))
    .patch(
      "/api/v1/clusters/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        return audited(db, { principal: p, request }, "cluster.update", { type: "cluster", id: params.id }, async () => {
          await load(p, params.id, "admin");
          const [row] = await db.update(clusters).set({ labels: body.labels, updatedAt: new Date() }).where(eq(clusters.id, params.id)).returning();
          return view(row!);
        });
      },
      { body: t.Object({ labels: Labels }) },
    )
    .delete(
      "/api/v1/clusters/:id",
      async ({ principal, request, params, query, set }) => {
        const p = authed(principal);
        await audited(db, { principal: p, request }, "cluster.delete", { type: "cluster", id: params.id }, async () => {
          const row = await load(p, params.id, "admin");
          const placed = await db.select().from(placements).where(eq(placements.clusterId, row.id));
          if (placed.length && query.force !== "true") throw new ApiError(409, "cluster_in_use", `${placed.length} tenant(s) are placed on this cluster; remove them or pass force=true`);
          // Best effort: the cluster may already be gone.
          try {
            await clusterClient({ secretKey }, row).request("DELETE", `/1.0/certificates/${fingerprintOf(row.clientCert)}`);
          } catch (e) {
            log.warn("could not remove the control plane certificate from the cluster", { cluster: row.name, error: (e as Error).message });
          }
          await db.transaction(async (tx) => {
            await tx.delete(clusters).where(eq(clusters.id, row.id));
            await authz.write([], [tuples.cluster(row.id), ...placed.map((x) => tuples.placement(x.tenantId, row.id))]);
          });
        });
        return noContent(set);
      },
      { query: t.Object({ force: t.Optional(t.String()) }) },
    )
    .get("/api/v1/clusters/:id/tenants", async ({ principal, params }) => {
      await load(authed(principal), params.id, "viewer");
      return db
        .select({ tenantId: placements.tenantId, slug: tenants.slug, project: placements.project, status: placements.status, statusMessage: placements.statusMessage, createdAt: placements.createdAt })
        .from(placements)
        .innerJoin(tenants, eq(tenants.id, placements.tenantId))
        .where(eq(placements.clusterId, params.id))
        .orderBy(tenants.slug);
    })
    .put("/api/v1/clusters/:id/tenants/:tenantId", async ({ principal, request, params }) => {
      const p = authed(principal);
      return audited(db, { principal: p, request }, "cluster.tenant.place", { type: "cluster", id: params.id }, async () => {
        await load(p, params.id, "can_access");
        await needOperator(p);
        const [tenant] = await db.select().from(tenants).where(eq(tenants.id, uuidParam(params.tenantId, "No such tenant")));
        if (!tenant) throw notFound("No such tenant");
        await db.insert(placements).values({ tenantId: tenant.id, clusterId: params.id, project: tenant.slug }).onConflictDoNothing();
        await authz.write([tuples.placement(tenant.id, params.id)]);
        const [row] = await db.select().from(placements).where(and(eq(placements.tenantId, tenant.id), eq(placements.clusterId, params.id)));
        return row!;
      }, (r) => ({ tenantId: r.tenantId }));
    })
    .delete("/api/v1/clusters/:id/tenants/:tenantId", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "cluster.tenant.remove", { type: "cluster", id: params.id }, async () => {
        await load(p, params.id, "can_access");
        await needOperator(p);
        const removed = await db.delete(placements).where(and(eq(placements.clusterId, params.id), eq(placements.tenantId, uuidParam(params.tenantId)))).returning();
        if (!removed.length) throw notFound("This tenant is not on this cluster");
        await authz.write([], [tuples.placement(params.tenantId, params.id)]);
      }, () => ({ tenantId: params.tenantId }));
      return noContent(set);
    });
}
