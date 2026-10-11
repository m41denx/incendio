import { Elysia, t } from "elysia";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { backupPolicies, backups, backupTargets, clusters, placements } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { can, forbidden, notFound, platformCan } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { seal } from "../lib/secrets.ts";
import { enqueueJob } from "../jobs/queue.ts";
import type { BackupPayload } from "../backups/backup-job.ts";
import type { RestorePayload } from "../backups/restore-job.ts";
import { s3StoreFor, type StoreFor } from "../backups/store.ts";
import { audited, created, noContent, uuidParam, visibleTenants } from "./common.ts";
import { visibleInventoryInstance } from "./mobility.ts";

const NAME = "^[a-zA-Z][a-zA-Z0-9-]{0,62}$";
const pgCode = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x.code ?? x.cause?.code;
};
type Target = typeof backupTargets.$inferSelect;
/** A target as operators see it: everything but the secret. */
const publicTarget = ({ secretKeyEnc: _, ...rest }: Target) => rest;

const TargetFields = {
  endpoint: t.String({ pattern: "^https?://[^\\s]+$", maxLength: 500 }),
  region: t.String({ maxLength: 63 }),
  bucket: t.String({ minLength: 3, maxLength: 63 }),
  prefix: t.String({ maxLength: 200 }),
  accessKeyId: t.String({ minLength: 1, maxLength: 200 }),
  secretKey: t.String({ minLength: 1, maxLength: 500 }),
  enabled: t.Boolean(),
};

/** Backups (P7): targets for platform admins; backups, restores and policies like the tenant's instances. */
export function backupsRoutes({ db, authz, secretKey, storeFor }: { db: Db; authz: Authz; secretKey: Buffer; storeFor?: StoreFor }) {
  const stores = storeFor ?? s3StoreFor(secretKey);

  /** Rows of `table` whose tenant the caller sees: a condition, none (all), or null (nothing). */
  const visibility = async (p: Principal, col: typeof backups.tenantId | typeof backupPolicies.tenantId): Promise<SQL | undefined | null> => {
    const v = await visibleTenants(db, authz, p);
    if (v === "all") return undefined;
    return v.length ? inArray(col, v) : null;
  };
  /** Platform operators, or the tenant's owners and admins. */
  const manages = async (p: Principal, tenantId: string | null) => (await platformCan(authz, p, "operator")) || (!!tenantId && (await can(authz, p, "admin", `tenant:${tenantId}`)));
  const requireAdmin = async (p: Principal) => {
    if (!(await platformCan(authz, p, "admin"))) throw forbidden();
  };
  const loadTarget = async (id: string) => {
    const [row] = await db.select().from(backupTargets).where(eq(backupTargets.id, uuidParam(id, "Target not found")));
    if (!row) throw notFound("Target not found");
    return row;
  };
  const usableTarget = async (id: string) => {
    const row = await loadTarget(id);
    if (!row.enabled) throw new ApiError(409, "conflict", `The backup target "${row.name}" is disabled`);
    return row;
  };
  const loadBackup = async (p: Principal, id: string) => {
    const vis = await visibility(p, backups.tenantId);
    if (vis === null) throw notFound("Backup not found");
    const [row] = await db
      .select()
      .from(backups)
      .where(and(eq(backups.id, uuidParam(id, "Backup not found")), vis));
    if (!row) throw notFound("Backup not found");
    return row;
  };
  const loadPolicy = async (p: Principal, id: string) => {
    const vis = await visibility(p, backupPolicies.tenantId);
    if (vis === null) throw notFound("Policy not found");
    const [row] = await db
      .select()
      .from(backupPolicies)
      .where(and(eq(backupPolicies.id, uuidParam(id, "Policy not found")), vis));
    if (!row) throw notFound("Policy not found");
    return row;
  };
  const managedPolicy = async (p: Principal, id: string) => {
    const row = await loadPolicy(p, id);
    if (!(await manages(p, row.tenantId))) throw forbidden();
    return row;
  };

  const queueBackup = (p: Principal | { kind: string; id: string }, tenantId: string | null, payload: BackupPayload) =>
    enqueueJob(db, {
      type: "backup",
      payload: payload as unknown as Record<string, unknown>,
      actor: { type: p.kind, id: p.id },
      tenantId,
      clusterIds: [payload.clusterId],
      instanceKey: `${payload.clusterId}/${payload.project}/${payload.instanceName}`,
    });

  /**
   * Where a caller may restore a backup: platform operators anywhere (the
   * project they name, else the tenant's placement there, else the backup's
   * project); tenant owners and admins into their tenant's ready placement,
   * the same cluster included, without choosing a pool.
   */
  const restoreTarget = async (p: Principal, b: typeof backups.$inferSelect, body: { targetClusterId: string; targetProject?: string; pool?: string }) => {
    const [dst] = await db
      .select()
      .from(clusters)
      .where(eq(clusters.id, uuidParam(body.targetClusterId, "Target cluster not found")));
    if (!dst) throw notFound("Target cluster not found");
    if (dst.status === "disabled") throw new ApiError(400, "invalid_request", "The target cluster is disabled");
    const [placement] = b.tenantId ? await db.select().from(placements).where(and(eq(placements.tenantId, b.tenantId), eq(placements.clusterId, dst.id))) : [];
    if (await platformCan(authz, p, "operator")) return { dst, project: body.targetProject ?? placement?.project ?? b.project, pool: body.pool };
    if (!b.tenantId || !(await can(authz, p, "admin", `tenant:${b.tenantId}`))) throw forbidden();
    if (body.pool) throw new ApiError(403, "forbidden", "Only platform operators choose the storage pool");
    if (placement?.status !== "ready") throw new ApiError(403, "forbidden", "The tenant is not placed on that cluster");
    if (body.targetProject && body.targetProject !== placement.project) throw forbidden();
    return { dst, project: placement.project, pool: undefined };
  };

  return (
    new Elysia({ name: "backups" })
      .use(principalContext)

      // Targets
      .get("/api/v1/backup-targets", async ({ principal }) => {
        const p = authed(principal);
        const rows = await db.select().from(backupTargets).orderBy(backupTargets.name);
        if (await platformCan(authz, p, "viewer")) return rows.map(publicTarget);
        return rows.filter((r) => r.enabled).map((r) => ({ id: r.id, name: r.name }));
      })
      .post(
        "/api/v1/backup-targets",
        async ({ principal, request, body, set }) => {
          const p = authed(principal);
          const row = await audited(db, { principal: p, request }, "backup_target.create", (r) => r && { type: "backup_target", id: r.id }, async () => {
            await requireAdmin(p);
            const { secretKey: secret, ...rest } = body;
            try {
              const [r] = await db
                .insert(backupTargets)
                .values({ ...rest, secretKeyEnc: seal(secretKey, secret) })
                .returning();
              return publicTarget(r!);
            } catch (e) {
              if (pgCode(e) === "23505") throw new ApiError(409, "conflict", `A target named "${body.name}" already exists`);
              throw e;
            }
          });
          return created(set, row);
        },
        {
          body: t.Object({
            name: t.String({ pattern: NAME }),
            endpoint: TargetFields.endpoint,
            region: t.Optional(TargetFields.region),
            bucket: TargetFields.bucket,
            prefix: t.Optional(TargetFields.prefix),
            accessKeyId: TargetFields.accessKeyId,
            secretKey: TargetFields.secretKey,
            enabled: t.Optional(TargetFields.enabled),
          }),
        },
      )
      .patch(
        "/api/v1/backup-targets/:id",
        async ({ principal, request, params, body }) => {
          const p = authed(principal);
          return audited(db, { principal: p, request }, "backup_target.update", { type: "backup_target", id: params.id }, async () => {
            await requireAdmin(p);
            await loadTarget(params.id);
            const { secretKey: secret, ...rest } = body;
            const [r] = await db
              .update(backupTargets)
              .set({ ...rest, ...(secret && { secretKeyEnc: seal(secretKey, secret) }) })
              .where(eq(backupTargets.id, params.id))
              .returning();
            return publicTarget(r!);
          });
        },
        { body: t.Partial(t.Object(TargetFields)) },
      )
      .delete("/api/v1/backup-targets/:id", async ({ principal, request, params, set }) => {
        const p = authed(principal);
        await audited(db, { principal: p, request }, "backup_target.delete", { type: "backup_target", id: params.id }, async () => {
          await requireAdmin(p);
          await loadTarget(params.id);
          try {
            await db.delete(backupTargets).where(eq(backupTargets.id, params.id));
          } catch (e) {
            // 23001: the RESTRICT foreign keys of backups and policies.
            if (pgCode(e) === "23001" || pgCode(e) === "23503") throw new ApiError(409, "conflict", "Backups or policies still use this target");
            throw e;
          }
        });
        return noContent(set);
      })
      .post("/api/v1/backup-targets/:id/check", async ({ principal, params }) => {
        const p = authed(principal);
        await requireAdmin(p);
        try {
          await stores(await loadTarget(params.id)).check();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      })

      // Backups
      .post(
        "/api/v1/instances/:id/backups",
        async ({ principal, request, params, body, set }) => {
          const p = authed(principal);
          const job = await audited(db, { principal: p, request }, "backup.create", { type: "instance", id: params.id }, async () => {
            const inst = await visibleInventoryInstance(db, authz, p, params.id);
            if (!(await manages(p, inst.tenantId))) throw forbidden();
            if (body.transport && body.transport !== "auto" && !(await platformCan(authz, p, "operator"))) throw new ApiError(403, "forbidden", "Only platform operators choose the transport");
            const target = await usableTarget(body.targetId);
            return queueBackup(p, inst.tenantId, { clusterId: inst.clusterId, project: inst.project, instanceName: inst.name, targetId: target.id, instanceOnly: body.instanceOnly ?? false, transport: body.transport ?? "auto" });
          });
          set.status = 202;
          return job;
        },
        {
          body: t.Object({
            targetId: t.String(),
            instanceOnly: t.Optional(t.Boolean()),
            /** Platform operators only. */
            transport: t.Optional(t.Union([t.Literal("auto"), t.Literal("direct"), t.Literal("relay")])),
          }),
        },
      )
      .get(
        "/api/v1/backups",
        async ({ principal, query }) => {
          const p = authed(principal);
          const vis = await visibility(p, backups.tenantId);
          if (vis === null) return [];
          const where: (SQL | undefined)[] = [vis];
          if (query.instance) {
            const inst = await visibleInventoryInstance(db, authz, p, query.instance);
            where.push(eq(backups.clusterId, inst.clusterId), eq(backups.project, inst.project), eq(backups.instanceName, inst.name));
          }
          if (query.tenant) where.push(eq(backups.tenantId, uuidParam(query.tenant, "Tenant not found")));
          if (query.policy) where.push(eq(backups.policyId, uuidParam(query.policy, "Policy not found")));
          const rows = await db
            .select({ b: backups, targetName: backupTargets.name, clusterName: clusters.name })
            .from(backups)
            .innerJoin(backupTargets, eq(backupTargets.id, backups.targetId))
            .leftJoin(clusters, eq(clusters.id, backups.clusterId))
            .where(and(...where))
            .orderBy(desc(backups.createdAt))
            .limit(500);
          return rows.map((r) => ({ ...r.b, targetName: r.targetName, clusterName: r.clusterName }));
        },
        { query: t.Object({ instance: t.Optional(t.String()), tenant: t.Optional(t.String()), policy: t.Optional(t.String()) }) },
      )
      .get("/api/v1/backups/:id", async ({ principal, params }) => loadBackup(authed(principal), params.id))
      .delete("/api/v1/backups/:id", async ({ principal, request, params, set }) => {
        const p = authed(principal);
        await audited(db, { principal: p, request }, "backup.delete", { type: "backup", id: params.id }, async () => {
          const b = await loadBackup(p, params.id);
          if (!(await manages(p, b.tenantId))) throw forbidden();
          if (b.state === "creating") throw new ApiError(409, "conflict", "This backup is still being made");
          // Object first: a row without its object is harmless, an object without its row is lost space.
          await stores(await loadTarget(b.targetId)).delete(b.objectKey);
          await db.delete(backups).where(eq(backups.id, b.id));
        });
        return noContent(set);
      })
      .post(
        "/api/v1/backups/:id/restore",
        async ({ principal, request, params, body, set }) => {
          const p = authed(principal);
          const job = await audited(db, { principal: p, request }, "backup.restore", { type: "backup", id: params.id }, async () => {
            const b = await loadBackup(p, params.id);
            if (!(await manages(p, b.tenantId))) throw forbidden();
            if (b.state !== "ready") throw new ApiError(409, "conflict", `Only a ready backup can be restored (this one is ${b.state})`);
            const to = await restoreTarget(p, b, body);
            const payload: RestorePayload = { backupId: b.id, targetClusterId: to.dst.id, targetProject: to.project, targetName: body.targetName ?? b.instanceName, start: body.start ?? false, ...(to.pool && { pool: to.pool }) };
            return enqueueJob(db, { type: "restore", payload: payload as unknown as Record<string, unknown>, actor: { type: p.kind, id: p.id }, tenantId: b.tenantId, clusterIds: [to.dst.id] });
          });
          set.status = 202;
          return job;
        },
        {
          body: t.Object({
            targetClusterId: t.String(),
            targetName: t.Optional(t.String({ pattern: NAME })),
            /** Platform operators only. */
            targetProject: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
            pool: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
            start: t.Optional(t.Boolean()),
          }),
        },
      )

      // Policies
      .get("/api/v1/backup-policies", async ({ principal }) => {
        const vis = await visibility(authed(principal), backupPolicies.tenantId);
        if (vis === null) return [];
        return db.select().from(backupPolicies).where(vis).orderBy(desc(backupPolicies.createdAt));
      })
      .post(
        "/api/v1/backup-policies",
        async ({ principal, request, body, set }) => {
          const p = authed(principal);
          const row = await audited(db, { principal: p, request }, "backup_policy.create", (r) => r && { type: "backup_policy", id: r.id }, async () => {
            const inst = await visibleInventoryInstance(db, authz, p, body.instanceId);
            if (!(await manages(p, inst.tenantId))) throw forbidden();
            const target = await usableTarget(body.targetId);
            try {
              const [r] = await db
                .insert(backupPolicies)
                .values({ tenantId: inst.tenantId, clusterId: inst.clusterId, project: inst.project, instanceName: inst.name, targetId: target.id, intervalS: body.intervalS, keep: body.keep, instanceOnly: body.instanceOnly, createdBy: `${p.kind}:${p.id}` })
                .returning();
              return r!;
            } catch (e) {
              if (pgCode(e) === "23505") throw new ApiError(409, "conflict", "This instance already has a policy for that target");
              throw e;
            }
          });
          return created(set, row);
        },
        {
          body: t.Object({
            instanceId: t.String(),
            targetId: t.String(),
            intervalS: t.Optional(t.Integer({ minimum: 3600, maximum: 2592000 })),
            keep: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
            instanceOnly: t.Optional(t.Boolean()),
          }),
        },
      )
      .get("/api/v1/backup-policies/:id", async ({ principal, params }) => loadPolicy(authed(principal), params.id))
      .patch(
        "/api/v1/backup-policies/:id",
        async ({ principal, request, params, body }) => {
          const p = authed(principal);
          return audited(db, { principal: p, request }, "backup_policy.update", { type: "backup_policy", id: params.id }, async () => {
            await managedPolicy(p, params.id);
            if (body.targetId) await usableTarget(body.targetId);
            const [r] = await db.update(backupPolicies).set(body).where(eq(backupPolicies.id, params.id)).returning();
            return r!;
          });
        },
        {
          body: t.Object({
            enabled: t.Optional(t.Boolean()),
            intervalS: t.Optional(t.Integer({ minimum: 3600, maximum: 2592000 })),
            keep: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
            instanceOnly: t.Optional(t.Boolean()),
            targetId: t.Optional(t.String()),
          }),
        },
      )
      .delete("/api/v1/backup-policies/:id", async ({ principal, request, params, set }) => {
        const p = authed(principal);
        // Its backups stay, as manual ones: deleting a schedule is not deleting data.
        await audited(db, { principal: p, request }, "backup_policy.delete", { type: "backup_policy", id: params.id }, async () => {
          await managedPolicy(p, params.id);
          await db.delete(backupPolicies).where(eq(backupPolicies.id, params.id));
        });
        return noContent(set);
      })
      .post("/api/v1/backup-policies/:id/run", async ({ principal, request, params, set }) => {
        const p = authed(principal);
        const job = await audited(db, { principal: p, request }, "backup_policy.run", { type: "backup_policy", id: params.id }, async () => {
          const r = await managedPolicy(p, params.id);
          await usableTarget(r.targetId);
          const j = await queueBackup(p, r.tenantId, { clusterId: r.clusterId, project: r.project, instanceName: r.instanceName, targetId: r.targetId, instanceOnly: r.instanceOnly, transport: "auto", policyId: r.id });
          await db.update(backupPolicies).set({ lastRunAt: new Date(), lastJobId: j.id }).where(eq(backupPolicies.id, r.id));
          return j;
        });
        set.status = 202;
        return job;
      })
  );
}
