import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterGrants, clusters, instances, placements, platformRoles, serviceAccounts, tenantMembers, tenants, users } from "../db/schema.ts";
import { clusterClient } from "../clusters/enroll.ts";
import type { IncusServer } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import type { Tuple } from "../authz/platform.ts";
import type { ClusterStore, ClusterStoreConfig } from "./cluster-store.ts";
import { desiredGrants, diffTuples, explicitRelations, type Decision, type GrantFacts, type ProjectFacts } from "./grants.ts";
import { Acl } from "../acl/acl.ts";
import { clusterConfigFor, ensureServerConfig } from "./incus-config.ts";
import { ensureDefaultProfile, ensureProject, projectUsage } from "./projects.ts";
import { splitLimits } from "../tenants/quota.ts";

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
    const facts = await grantFacts(db, placed);
    await addExplicit(db, facts, row.name, client, clusterId);

    if (!(await waitForModel(store, deps.modelWaitMs ?? 10_000))) {
      problems.push("grants: waiting for Incus to upload its OpenFGA model");
    } else {
      const scanDue = newStore || !row.grantsScannedAt || Date.now() - row.grantsScannedAt.getTime() >= (deps.scanIntervalMs ?? 3_600_000);
      await syncGrants(deps, clusterId, store, facts, scanDue);
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
    const here = and(eq(placements.tenantId, p.tenantId), eq(placements.clusterId, clusterId));
    try {
      // This project's usage now, then its share of what the tenant has left across its placements (P9).
      const usage = await projectUsage(client, p.project);
      await deps.db.update(placements).set({ usage }).where(here);
      const all = await deps.db.select({ clusterId: placements.clusterId, usage: placements.usage }).from(placements).where(eq(placements.tenantId, p.tenantId));
      const limits = splitLimits(p.quotas, all.map((x) => x.usage))[all.findIndex((x) => x.clusterId === clusterId)]!;
      await ensureProject(client, p.project, { id: p.tenantId, slug: p.slug }, limits);
      await deps.db.update(placements).set({ limits }).where(here);
      await ensureDefaultProfile(client, p.project, p.quotas);
    } catch (e) {
      status = "error";
      message = (e as Error).message;
      foreign = e instanceof ApiError && e.code === "project_exists";
      problems.push(`${p.project}: ${message}`);
    }
    // Never grant on a project that is not this tenant's; transient failures keep existing grants.
    if (!foreign) placed.push({ tenantId: p.tenantId, project: p.project });
    await deps.db.update(placements).set({ status, statusMessage: message }).where(here);
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
 * Subjects with explicit permission entries get their relations from the
 * ACL (through `incuscloud-acl-*` groups) instead of today's role groups, so
 * an entry can narrow what a role gives. Others keep today's tuples exactly.
 */
async function addExplicit(db: Db, facts: GrantFacts, cluster: string, client: ReturnType<typeof clusterClient>, clusterId: string) {
  const acl = new Acl(db, { ttlMs: 60_000 });
  const keys = [...new Set((await acl.entries()).filter((e) => e.source === "acl").map((e) => e.subject))];
  if (!keys.length) return;
  const { disabled } = await acl.lookup();
  const accounts = new Map((await db.select({ id: serviceAccounts.id, clientId: serviceAccounts.clientId }).from(serviceAccounts)).map((a) => [a.id, a.clientId]));
  // Never a project that is another's: a tenant's placement here that could not be granted.
  const grantable = new Set(facts.placements.map((p) => p.project));
  const taken = (await db.select({ project: placements.project }).from(placements).where(eq(placements.clusterId, clusterId))).map((p) => p.project).filter((p) => !grantable.has(p));
  const listed = (await client.request<string[]>("GET", "/1.0/projects")).metadata.map((u) => decodeURIComponent(u.split("/").pop()!));
  const projects = listed.filter((p) => !taken.includes(p));
  // Instances from the inventory: entries and owners on them become instance relations.
  const inventory = await db.select({ project: instances.project, name: instances.name }).from(instances).where(eq(instances.clusterId, clusterId));
  const facts_: ProjectFacts[] = projects.map((name) => ({ name, instances: inventory.filter((i) => i.project === name).map((i) => i.name), shared: [] }));
  const names = new Set<string>();
  const subjects: Array<{ subject: string; decided: Map<string, Decision> }> = [];
  for (const key of keys) {
    const [kind, id] = key.split(":") as [string, string];
    const subject = kind === "service" ? accounts.get(id) : id;
    if (!subject) continue;
    names.add(subject);
    if (disabled.has(key)) continue;
    const decided = new Map<string, Decision>();
    const paths = [`/clusters/${cluster}`, ...facts_.flatMap((p) => [`/clusters/${cluster}/projects/${p.name}`, ...p.instances.map((i) => `/clusters/${cluster}/projects/${p.name}/instances/${i}`)])];
    for (const path of paths) {
      const d = await acl.explain(key, path);
      decided.set(path, { roles: d.decidedBy.map((e) => e.role), at: d.decidedBy[0]?.path, privileges: new Set(d.privileges) });
    }
    subjects.push({ subject, decided });
  }
  // What a User must see to create in a project: listed only for projects a User is decided on.
  for (const p of facts_) {
    const path = `/clusters/${cluster}/projects/${p.name}`;
    if (subjects.some((s) => s.decided.get(path)?.roles.includes("user"))) p.shared = await sharedObjects(client, p.name);
  }
  facts.acl = [];
  for (const { subject, decided } of subjects) {
    for (const r of explicitRelations(cluster, facts_, (p) => decided.get(p) ?? { roles: [] })) facts.acl.push({ subject, ...r });
  }
  facts.members = facts.members.filter((m) => !names.has(m.subject));
  facts.platform = facts.platform.filter((m) => !names.has(m.subject));
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

/** A project's profiles, networks and images as OpenFGA objects (networks and images may be another project's, as Incus reports). */
async function sharedObjects(client: ReturnType<typeof clusterClient>, project: string): Promise<string[]> {
  const q = `project=${encodeURIComponent(project)}&recursion=1`;
  const list = async <T>(path: string) => (await client.request<T[]>("GET", `${path}?${q}`)).metadata ?? [];
  const [profiles, networks, images] = await Promise.all([
    list<{ name: string; project?: string }>("/1.0/profiles"),
    list<{ name: string; project?: string; managed?: boolean }>("/1.0/networks"),
    list<{ fingerprint: string; project?: string }>("/1.0/images"),
  ]);
  return [
    ...profiles.map((x) => `profile:${x.project || project}/${x.name}`),
    ...networks.filter((x) => x.managed !== false).map((x) => `network:${x.project || project}/${x.name}`),
    ...images.map((x) => `image:${x.project || project}/${x.fingerprint}`),
  ];
}
