import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterGrants, clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import { clusterClient } from "../clusters/enroll.ts";
import type { IncusServer } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import type { Tuple } from "../authz/platform.ts";
import type { ClusterStore, ClusterStoreConfig } from "./cluster-store.ts";
import { desiredGrants, diffTuples, type GrantFacts } from "./grants.ts";
import { clusterConfigFor, ensureServerConfig } from "./incus-config.ts";
import { ensureDefaultProfile, ensureProject } from "./projects.ts";

export interface ReconcileDeps {
  db: Db;
  secretKey: Buffer;
  openStore: (cfg: ClusterStoreConfig) => Promise<ClusterStore>;
  /** What clusters must trust (spec D3). */
  oidc: { issuer: string; clientId: string; audience: string };
  /** `url`/`token`: how IncusCloud reaches OpenFGA; `clusterUrl`/`clusterToken`: how clusters do. */
  openfga: { url: string; token?: string; clusterUrl: string; clusterToken?: string };
  /** How long to wait for Incus to upload its model into a new store (default 10 s). */
  modelWaitMs?: number;
  /** How often to scan a store in full for stray IncusCloud tuples (default 1 h). */
  scanIntervalMs?: number;
}

export type ReconcileStatus = "ready" | "degraded" | "error" | "disabled";
export interface ReconcileResult {
  status: ReconcileStatus;
  message: string;
}

export const storeNameFor = (clusterId: string) => `incuscloud-cluster-${clusterId}`;

/** Brings one cluster in line with the database (spec §5): config, tenant projects, grants. */
export async function reconcileCluster(deps: ReconcileDeps, clusterId: string): Promise<ReconcileResult> {
  const { db } = deps;
  const [row] = await db.select().from(clusters).where(eq(clusters.id, clusterId));
  if (!row) throw new ApiError(404, "not_found", "Cluster not found");
  if (row.status === "disabled") return { status: "disabled", message: "" };

  const finish = async (r: ReconcileResult, extra: Partial<typeof clusters.$inferInsert> = {}) => {
    await db
      .update(clusters)
      .set({ status: r.status, statusMessage: r.message, reconciledAt: new Date(), ...extra })
      .where(eq(clusters.id, clusterId));
    return r;
  };

  const client = clusterClient(deps, row);
  try {
    await client.request<IncusServer>("GET", "/1.0");
  } catch (e) {
    return finish({ status: "error", message: `Cannot reach the cluster: ${(e as Error).message}` });
  }
  const seen = { lastSeenAt: new Date() };

  const problems: string[] = [];
  try {
    // Store first: the cluster config names it.
    const store = await deps.openStore({ url: deps.openfga.url, token: deps.openfga.token, storeId: row.fgaStoreId, name: storeNameFor(clusterId) });
    const newStore = store.storeId !== row.fgaStoreId;
    if (newStore) {
      await db.transaction(async (tx) => {
        await tx.update(clusters).set({ fgaStoreId: store.storeId }).where(eq(clusters.id, clusterId));
        await tx.delete(clusterGrants).where(eq(clusterGrants.clusterId, clusterId));
      });
    }

    await ensureServerConfig(
      client,
      clusterConfigFor({ ...deps.oidc, openfgaUrl: deps.openfga.clusterUrl, openfgaToken: deps.openfga.clusterToken, storeId: store.storeId }),
    );

    const placed = await ensurePlacements(deps, clusterId, client, problems);

    if (!(await waitForModel(store, deps.modelWaitMs ?? 10_000))) {
      problems.push("grants: waiting for Incus to upload its OpenFGA model");
    } else {
      const scanDue = newStore || !row.grantsScannedAt || Date.now() - row.grantsScannedAt.getTime() >= (deps.scanIntervalMs ?? 3_600_000);
      await syncGrants(deps, clusterId, store, await grantFacts(db, placed), scanDue);
    }
  } catch (e) {
    problems.push((e as Error).message);
  }
  return finish(problems.length ? { status: "degraded", message: problems.join("; ") } : { status: "ready", message: "" }, seen);
}

/** Creates or updates each placed tenant's project; returns the placements that may be granted. */
async function ensurePlacements(deps: ReconcileDeps, clusterId: string, client: ReturnType<typeof clusterClient>, problems: string[]) {
  const rows = await deps.db
    .select({ tenantId: placements.tenantId, project: placements.project, slug: tenants.slug, quotas: tenants.quotas })
    .from(placements)
    .innerJoin(tenants, eq(tenants.id, placements.tenantId))
    .where(eq(placements.clusterId, clusterId));
  const placed: GrantFacts["placements"] = [];
  for (const p of rows) {
    let status = "ready";
    let message = "";
    let foreign = false;
    try {
      await ensureProject(client, p.project, { id: p.tenantId, slug: p.slug, quotas: p.quotas });
      await ensureDefaultProfile(client, p.project, p.quotas);
    } catch (e) {
      status = "error";
      message = (e as Error).message;
      foreign = e instanceof ApiError && e.code === "project_exists";
      problems.push(`${p.project}: ${message}`);
    }
    // Never grant on a project that is not this tenant's; transient failures keep existing grants.
    if (!foreign) placed.push({ tenantId: p.tenantId, project: p.project });
    await deps.db
      .update(placements)
      .set({ status, statusMessage: message })
      .where(and(eq(placements.tenantId, p.tenantId), eq(placements.clusterId, clusterId)));
  }
  return placed;
}

async function waitForModel(store: ClusterStore, waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    if (await store.hasModel()) return true;
    if (Date.now() >= until) return false;
    await Bun.sleep(500);
  }
}

/** Who should hold which role on this cluster; disabled users and service accounts hold none. */
async function grantFacts(db: Db, placed: GrantFacts["placements"]): Promise<GrantFacts> {
  const tenantIds = placed.map((p) => p.tenantId);
  const members: GrantFacts["members"] = [];
  if (tenantIds.length) {
    const ms = await db
      .select({ tenantId: tenantMembers.tenantId, subject: tenantMembers.userId, role: tenantMembers.role })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(inArray(tenantMembers.tenantId, tenantIds), eq(users.disabled, false)));
    const sas = await db
      .select({ tenantId: serviceAccounts.tenantId, subject: serviceAccounts.clientId })
      .from(serviceAccounts)
      .where(and(inArray(serviceAccounts.tenantId, tenantIds), eq(serviceAccounts.disabled, false)));
    members.push(...ms, ...sas.map((s) => ({ tenantId: s.tenantId!, subject: s.subject, role: "member" })));
  }
  const userRoles = await db
    .select({ subject: platformRoles.userId, role: platformRoles.role })
    .from(platformRoles)
    .innerJoin(users, eq(users.id, platformRoles.userId))
    .where(eq(users.disabled, false));
  const saRoles = await db
    .select({ subject: serviceAccounts.clientId, role: serviceAccounts.platformRole })
    .from(serviceAccounts)
    .where(and(isNotNull(serviceAccounts.platformRole), eq(serviceAccounts.disabled, false)));
  return { placements: placed, members, platform: [...userRoles, ...saRoles.map((s) => ({ subject: s.subject, role: s.role! }))] };
}

/**
 * Writes the difference between what the store should hold and what IncusCloud last wrote there
 * (recorded in cluster_grants). A due scan reads the store instead, removing stray IncusCloud
 * tuples and restoring deleted ones; tuples IncusCloud does not own are never touched.
 */
async function syncGrants(deps: ReconcileDeps, clusterId: string, store: ClusterStore, facts: GrantFacts, scan: boolean) {
  const { db } = deps;
  const desired = desiredGrants(facts);
  const current: Tuple[] = scan
    ? await store.readManaged()
    : await db.select({ user: clusterGrants.user, relation: clusterGrants.relation, object: clusterGrants.object }).from(clusterGrants).where(eq(clusterGrants.clusterId, clusterId));
  const { writes, deletes } = diffTuples(desired, current);
  await store.write(writes, deletes);
  if (!writes.length && !deletes.length && !scan) return;
  await db.transaction(async (tx) => {
    await tx.delete(clusterGrants).where(eq(clusterGrants.clusterId, clusterId));
    if (desired.length) await tx.insert(clusterGrants).values(desired.map((t) => ({ clusterId, ...t }))).onConflictDoNothing();
    if (scan) await tx.update(clusters).set({ grantsScannedAt: new Date() }).where(eq(clusters.id, clusterId));
  });
}
