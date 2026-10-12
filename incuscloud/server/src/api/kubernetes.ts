import { Elysia, t } from "elysia";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, jobs, k8sClusters, placements, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { can, forbidden, needVisible, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { exceeds, sumUsage, type Usage } from "../tenants/quota.ts";
import type { Kube } from "../k8s/kube.ts";
import { clusterManifest } from "../k8s/manifests.ts";
import { KUBERNETES_VERSIONS, SIZES, namespaceOf, upgradeError, usageOf, type Size } from "../k8s/model.ts";
import { secretNameOf } from "../k8s/credentials.ts";
import { pickEndpoint } from "../k8s/endpoint.ts";
import { pendingOf } from "./tenant-cloud.ts";
import { audited, uuidParam, visibleTenants } from "./common.ts";

/** A DNS label short enough for CAPI's generated instance names. */
const NAME = "^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$";
const DEFAULT_PORTS: [number, number] = [16443, 16999];
/** Statuses in which a running job owns the cluster. */
const BUSY = ["creating", "provisioning", "deleting"];

type Row = typeof k8sClusters.$inferSelect;
const endpointOf = (r: Pick<Row, "endpointHost" | "endpointPort">) => `https://${r.endpointHost.includes(":") ? `[${r.endpointHost}]` : r.endpointHost}:${r.endpointPort}`;

const view = (r: Row, tenantSlug: string, clusterName: string) => ({
  id: r.id,
  tenantId: r.tenantId,
  tenantSlug,
  clusterId: r.clusterId,
  clusterName,
  name: r.name,
  version: r.version,
  controlPlanes: r.controlPlanes,
  workers: r.workers,
  size: r.size,
  endpoint: endpointOf(r),
  status: r.status,
  statusMessage: r.statusMessage,
  nodes: r.nodes,
  nodesReady: r.nodesReady,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  syncedAt: r.syncedAt,
});

const jobFor = (id: string) => sql`${jobs.payload}->>'k8sId' = ${id}`;
const lockTenant = (tx: Db, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-create:${tenantId}`}))`);

/** Kubernetes clusters (P10): tenant members create, scale and upgrade; tenant admins delete; on the management cluster through CAPI. */
export function kubernetesRoutes({ db, authz, kube, k8sPorts }: { db: Db; authz: Authz; kube?: Kube; k8sPorts?: [number, number] }) {
  const ports = k8sPorts ?? DEFAULT_PORTS;
  const enabled = (): Kube => {
    if (!kube) throw new ApiError(409, "kubernetes_disabled", "Kubernetes is not enabled: IncusCloud has no management cluster (IC_K8S_KUBECONFIG)");
    return kube;
  };
  /** Tenant members (or a stronger role) and platform operators. */
  const needRole = async (p: Principal, tenantId: string, role: "member" | "admin") => {
    if (!(await can(authz, p, role, `tenant:${tenantId}`)) && !(await platformCan(authz, p, "operator"))) throw forbidden();
  };
  const select = (where?: ReturnType<typeof and>) =>
    db
      .select({ row: k8sClusters, tenantSlug: tenants.slug, clusterName: clusters.name })
      .from(k8sClusters)
      .innerJoin(tenants, eq(tenants.id, k8sClusters.tenantId))
      .innerJoin(clusters, eq(clusters.id, k8sClusters.clusterId))
      .where(where)
      .orderBy(tenants.slug, k8sClusters.name);
  const load = async (p: Principal, id: string) => {
    enabled();
    const [found] = await select(eq(k8sClusters.id, uuidParam(id, "Kubernetes cluster not found")));
    if (!found) throw notFound("Kubernetes cluster not found");
    const v = await visibleTenants(db, authz, p);
    if (v !== "all" && !v.includes(found.row.tenantId)) throw notFound("Kubernetes cluster not found");
    return found;
  };

  return new Elysia()
    .use(principalContext)
    .get("/api/v1/kubernetes/versions", ({ principal }) => {
      authed(principal);
      return {
        enabled: !!kube,
        versions: KUBERNETES_VERSIONS,
        sizes: Object.fromEntries(Object.entries(SIZES).map(([k, s]) => [k, { cpu: s.cpu, memoryGiB: s.memoryGiB }])),
      };
    })
    .get(
      "/api/v1/kubernetes",
      async ({ principal, query }) => {
        const p = authed(principal);
        enabled();
        const v = await visibleTenants(db, authz, p);
        if (v !== "all" && !v.length) return [];
        const conds = [v === "all" ? undefined : inArray(k8sClusters.tenantId, v), query.tenant ? eq(k8sClusters.tenantId, uuidParam(query.tenant)) : undefined];
        return (await select(and(...conds))).map((x) => view(x.row, x.tenantSlug, x.clusterName));
      },
      { query: t.Object({ tenant: t.Optional(t.String()) }) },
    )
    .get("/api/v1/kubernetes/:id", async ({ principal, params }) => {
      const x = await load(authed(principal), params.id);
      return view(x.row, x.tenantSlug, x.clusterName);
    })
    .post(
      "/api/v1/kubernetes",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        enabled();
        await needVisible(authz, p, "viewer", "viewer", `tenant:${body.tenantId}`);
        await needRole(p, body.tenantId, "member");
        const req = usageOf(body.size, body.controlPlanes, body.workers);
        const r = await audited(db, { principal: p, request }, "kubernetes.create", { type: "tenant", id: body.tenantId }, () =>
          // One quota decision at a time per tenant, and one port choice at a time per cluster.
          db.transaction(async (tx) => {
            const txDb = tx as unknown as Db;
            await lockTenant(txDb, body.tenantId);
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`k8s-endpoint:${body.clusterId}`}))`);
            const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, body.tenantId));
            if (!tenant) throw notFound();
            const [placed] = await tx
              .select({ project: placements.project, status: placements.status, clusterName: clusters.name })
              .from(placements)
              .innerJoin(clusters, eq(clusters.id, placements.clusterId))
              .where(and(eq(placements.tenantId, tenant.id), eq(placements.clusterId, body.clusterId)));
            if (!placed) throw new ApiError(409, "not_placed", "The tenant is not placed on that cluster");
            if (placed.status !== "ready") throw new ApiError(409, "not_ready", `The tenant's project on ${placed.clusterName} is not ready yet`);
            const [taken] = await tx.select({ id: k8sClusters.id }).from(k8sClusters).where(and(eq(k8sClusters.tenantId, tenant.id), eq(k8sClusters.name, body.name)));
            if (taken) throw new ApiError(409, "conflict", `A Kubernetes cluster named "${body.name}" already exists in ${tenant.slug}`);
            const usage = await tx.select({ usage: placements.usage }).from(placements).where(eq(placements.tenantId, tenant.id));
            const over = exceeds(tenant.quotas, sumUsage([...usage.map((x) => x.usage), await pendingOf(txDb, tenant.id)]), req);
            if (over.length) throw new ApiError(409, "quota_exceeded", `Over the tenant's quota: ${over.join(", ")}`);
            const ep = await pickEndpoint(txDb, body.clusterId, ports);
            const [row] = await tx
              .insert(k8sClusters)
              .values({
                tenantId: tenant.id,
                clusterId: body.clusterId,
                name: body.name,
                namespace: namespaceOf(tenant.slug),
                version: body.version,
                controlPlanes: body.controlPlanes,
                workers: body.workers,
                size: body.size,
                endpointHost: ep.host,
                endpointPort: ep.port,
                lbMember: ep.member,
                createdBy: p.id,
              })
              .returning();
            const job = await enqueueJob(txDb, {
              type: "k8s-create",
              // Name and cluster for the job list; usage for quota checks while it runs.
              payload: { k8sId: row!.id, name: row!.name, clusterId: row!.clusterId, usage: req },
              actor: { type: p.kind, id: p.id },
              tenantId: tenant.id,
              clusterIds: [body.clusterId],
            });
            return { cluster: view(row!, tenant.slug, placed.clusterName), job };
          }),
        (r) => ({ k8sId: r.cluster.id, name: r.cluster.name }),
        );
        set.status = 202;
        return r;
      },
      {
        body: t.Object({
          tenantId: t.String({ format: "uuid" }),
          clusterId: t.String({ format: "uuid" }),
          name: t.String({ pattern: NAME }),
          version: t.Union(KUBERNETES_VERSIONS.map((v) => t.Literal(v))),
          controlPlanes: t.Union([t.Literal(1), t.Literal(3)]),
          workers: t.Integer({ minimum: 0, maximum: 20 }),
          size: t.Union((Object.keys(SIZES) as Size[]).map((s) => t.Literal(s))),
        }),
      },
    )
    .patch(
      "/api/v1/kubernetes/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        const { row, tenantSlug, clusterName } = await load(p, params.id);
        await needRole(p, row.tenantId, "member");
        const action = body.version && body.version !== row.version ? "kubernetes.upgrade" : "kubernetes.scale";
        const updated = await audited(db, { principal: p, request }, action, { type: "tenant", id: row.tenantId }, () =>
          db.transaction(async (tx) => {
            const txDb = tx as unknown as Db;
            await lockTenant(txDb, row.tenantId);
            const [cur] = await tx.select().from(k8sClusters).where(eq(k8sClusters.id, row.id));
            if (!cur) throw notFound("Kubernetes cluster not found");
            if (BUSY.includes(cur.status)) throw new ApiError(409, "busy", `${cur.name} is being created or deleted; try again when it is ready`);
            const next = { version: body.version ?? cur.version, controlPlanes: body.controlPlanes ?? cur.controlPlanes, workers: body.workers ?? cur.workers };
            if (next.version !== cur.version) {
              const why = upgradeError(cur.version, next.version);
              if (why) throw new ApiError(409, "bad_upgrade", why);
            }
            // Only growth needs room; shrinking is always allowed.
            const before = usageOf(cur.size, cur.controlPlanes, cur.workers, { lb: false });
            const after = usageOf(cur.size, next.controlPlanes, next.workers, { lb: false });
            const grow = Object.fromEntries(Object.keys(after).map((k) => [k, Math.max(0, after[k as keyof Usage] - before[k as keyof Usage])])) as unknown as Usage;
            if (grow.instances > 0) {
              const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, cur.tenantId));
              const usage = await tx.select({ usage: placements.usage }).from(placements).where(eq(placements.tenantId, cur.tenantId));
              const over = exceeds(tenant!.quotas, sumUsage([...usage.map((x) => x.usage), await pendingOf(txDb, cur.tenantId)]), grow);
              if (over.length) throw new ApiError(409, "quota_exceeded", `Over the tenant's quota: ${over.join(", ")}`);
            }
            const [saved] = await tx.update(k8sClusters).set(next).where(eq(k8sClusters.id, cur.id)).returning();
            await enabled().apply(clusterManifest({ ...saved!, secretName: secretNameOf({ name: clusterName }) }, { lbTarget: saved!.lbMember || undefined }));
            return saved!;
          }),
        (s) => ({ k8sId: s.id, version: s.version, controlPlanes: s.controlPlanes, workers: s.workers }),
        );
        return view(updated, tenantSlug, clusterName);
      },
      {
        body: t.Object({
          version: t.Optional(t.Union(KUBERNETES_VERSIONS.map((v) => t.Literal(v)))),
          controlPlanes: t.Optional(t.Union([t.Literal(1), t.Literal(3)])),
          workers: t.Optional(t.Integer({ minimum: 0, maximum: 20 })),
        }),
      },
    )
    .delete("/api/v1/kubernetes/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      const { row } = await load(p, params.id);
      await needRole(p, row.tenantId, "admin");
      const job = await audited(db, { principal: p, request }, "kubernetes.delete", { type: "tenant", id: row.tenantId }, () =>
        db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;
          await lockTenant(txDb, row.tenantId);
          const [active] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.type, "k8s-delete"), inArray(jobs.state, ["queued", "running"]), jobFor(row.id)));
          if (active) throw new ApiError(409, "conflict", `${row.name} is already being deleted`);
          await tx.update(k8sClusters).set({ status: "deleting", statusMessage: "" }).where(eq(k8sClusters.id, row.id));
          // A create still running stops; the delete job waits for it to end.
          await tx.update(jobs).set({ state: "cancelled", cancelRequested: true, finishedAt: new Date() }).where(and(eq(jobs.type, "k8s-create"), eq(jobs.state, "queued"), jobFor(row.id)));
          await tx.update(jobs).set({ cancelRequested: true }).where(and(eq(jobs.type, "k8s-create"), eq(jobs.state, "running"), jobFor(row.id)));
          return enqueueJob(txDb, { type: "k8s-delete", payload: { k8sId: row.id, name: row.name, clusterId: row.clusterId }, actor: { type: p.kind, id: p.id }, tenantId: row.tenantId, clusterIds: [row.clusterId] });
        }),
      () => ({ k8sId: row.id, name: row.name }),
      );
      set.status = 202;
      return job;
    })
    .get("/api/v1/kubernetes/:id/kubeconfig", async ({ principal, request, params }) => {
      const p = authed(principal);
      const { row } = await load(p, params.id);
      await needRole(p, row.tenantId, "member");
      const text = await audited(db, { principal: p, request }, "kubernetes.kubeconfig", { type: "tenant", id: row.tenantId }, async () => {
        // CAPI writes the admin kubeconfig once the control plane is up.
        const secret = (await enabled().get("v1", "Secret", row.namespace, `${row.name}-kubeconfig`)) as { data?: { value?: string } } | null;
        if (!secret?.data?.value) throw new ApiError(409, "not_ready", `The kubeconfig of ${row.name} is not available yet`);
        return Buffer.from(secret.data.value, "base64").toString("utf8");
      }, () => ({ k8sId: row.id, name: row.name }));
      return new Response(text, {
        headers: { "content-type": "application/yaml; charset=utf-8", "content-disposition": `attachment; filename="${row.name}.kubeconfig"`, "cache-control": "no-store" },
      });
    });
}
