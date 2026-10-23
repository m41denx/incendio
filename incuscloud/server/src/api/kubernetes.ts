import { Elysia, t } from "elysia";
import { needInstanceCaps, needKubernetesQuota } from "../tenants/limits.ts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters, jobs, k8sClusters, placements, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { forbidden, notFound } from "../authz/guards.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { exceeds, sumUsage, type Usage } from "../tenants/quota.ts";
import type { Kube, KubeObject } from "../k8s/kube.ts";
import { classBundle, clusterManifest } from "../k8s/manifests.ts";
import { KUBERNETES_VERSIONS, SIZES, lbIsInstance, namespaceOf, specError, specFromSize, upgradeError, usageOfSpec, type K8sSpec, type Size } from "../k8s/model.ts";
import { secretNameOf } from "../k8s/credentials.ts";
import { pickEndpoint, pickMember } from "../k8s/endpoint.ts";
import { kubeFromKubeconfig, metallbState, workloadKubeconfig } from "../k8s/metallb.ts";
import { parseRange } from "@incendio/k8s/src/lib/metallb.ts";
import { pendingOf } from "./tenant-cloud.ts";
import { eventActivity, mergeActivity, type ActivityEntry, type K8sEventList } from "@incendio/k8s/src/lib/activity.ts";
import { audited, filterAsync, uuidParam } from "./common.ts";
import { tuples } from "../authz/sync.ts";
import { requestReconcile } from "../reconcile/requests.ts";

/** A DNS label short enough for CAPI's generated instance names. */
const NAME = "^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$";
const DEFAULT_PORTS: [number, number] = [16443, 16999];
/** Statuses in which a running job owns the cluster. */
const BUSY = ["creating", "provisioning", "deleting"];

type Row = typeof k8sClusters.$inferSelect;
const endpointOf = (r: Pick<Row, "endpointHost" | "endpointPort">) => `https://${r.endpointHost.includes(":") ? `[${r.endpointHost}]` : r.endpointHost}:${r.endpointPort}`;

const view = (r: Row, tenantSlug: string, clusterName: string, project: string) => ({
  id: r.id,
  tenantId: r.tenantId,
  tenantSlug,
  clusterId: r.clusterId,
  clusterName,
  /** The tenant's Incus project on that cluster, where its instances run. */
  project,
  name: r.name,
  version: r.version,
  controlPlanes: r.controlPlanes,
  workers: r.workers,
  /** The size it was made with (clusters made before specs, or from a size); null when made from a spec. */
  size: r.size,
  spec: r.spec,
  endpoint: endpointOf(r),
  /** The member its load balancer and nodes are on ("" on a single-member Incus cluster). */
  member: r.lbMember,
  status: r.status,
  statusMessage: r.statusMessage,
  nodes: r.nodes,
  nodesReady: r.nodesReady,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  syncedAt: r.syncedAt,
});

const Profiles = t.Array(t.String({ minLength: 1, maxLength: 63 }), { maxItems: 16 });
const Flavor = t.String({ minLength: 1, maxLength: 32 });
const Target = t.String({ maxLength: 253 });
const Machine = t.Object({ type: t.Union([t.Literal("container"), t.Literal("virtual-machine")]), flavor: Flavor, profiles: Profiles, target: Target });
const Host = t.String({ maxLength: 253 });
/** Incendio's create options (see K8sSpec); specError checks what the schema cannot. */
const Spec = t.Object({
  controlPlane: Machine,
  worker: Machine,
  loadBalancer: t.Union([
    t.Object({ type: t.Union([t.Literal("lxc"), t.Literal("oci")]), flavor: Flavor, profiles: Profiles, target: Target }),
    t.Object({ type: t.Literal("kube-vip"), host: Host, interface: t.String({ maxLength: 63 }) }),
    t.Object({ type: t.Literal("ovn"), host: Host, networkName: t.String({ maxLength: 63 }) }),
  ]),
  image: t.String({ maxLength: 253 }),
  privileged: t.Boolean(),
  flannel: t.Boolean(),
  installKubeadm: t.Boolean(),
  podCidr: t.String({ maxLength: 43 }),
  serviceCidr: t.String({ maxLength: 43 }),
  metallb: t.Union([t.Null(), t.Object({ addresses: t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 }) })]),
});
const ControlPlanes = t.Union([t.Literal(1), t.Literal(3), t.Literal(5)]);

/** The member a spec's load balancer asks for ("@group" and "" ask for none). */
const lbMemberOf = (spec?: K8sSpec) => (spec && lbIsInstance(spec.loadBalancer) && spec.loadBalancer.target && !spec.loadBalancer.target.startsWith("@") ? spec.loadBalancer.target : undefined);

/** On a multi-member Incus cluster, what has no target goes on the member chosen (each member's bridge is its own network). */
function pinned(spec: K8sSpec, member: string): K8sSpec {
  if (!member) return spec;
  const pin = <T extends { target: string }>(x: T): T => (x.target ? x : { ...x, target: member });
  return { ...spec, controlPlane: pin(spec.controlPlane), worker: pin(spec.worker), loadBalancer: lbIsInstance(spec.loadBalancer) ? pin(spec.loadBalancer) : spec.loadBalancer };
}

/** kube-vip and OVN: the cluster's API at its own address, one cluster per address; the nodes still on one member. */
async function vipEndpoint(db: Db, clusterId: string, host: string, want?: string) {
  const [taken] = await db
    .select({ name: k8sClusters.name })
    .from(k8sClusters)
    .where(and(eq(k8sClusters.clusterId, clusterId), eq(k8sClusters.endpointHost, host), eq(k8sClusters.endpointPort, VIP_PORT)));
  // Not whose: the address may be another tenant's cluster.
  if (taken) throw new ApiError(409, "conflict", `${host}:${VIP_PORT} is already a Kubernetes API endpoint`);
  return { host, port: VIP_PORT, member: (await pickMember(db, clusterId, want)).member };
}
const VIP_PORT = 6443;

/** A read from the management cluster; its failure is a 503, not a 500. */
async function asked<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, "management_unavailable", `The management cluster did not answer: ${String((e as Error).message ?? e)}`);
  }
}

const jobFor = (id: string) => sql`${jobs.payload}->>'k8sId' = ${id}`;
const lockTenant = (tx: Db, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant-create:${tenantId}`}))`);

/** Kubernetes clusters (P10): tenant members create, scale and upgrade; tenant admins delete; on the management cluster through CAPI. */
const MACHINE_API = "cluster.x-k8s.io/v1beta2";

/** A Cluster API Machine as a node of its cluster: its Incus instance is its LXCMachine (CAPN names the instance after it). */
function nodeOf(m: KubeObject) {
  const spec = (m.spec ?? {}) as { version?: string; infrastructureRef?: { name?: string } };
  const status = (m.status ?? {}) as { phase?: string; nodeRef?: { name?: string }; conditions?: Array<{ type: string; status: string }> };
  return {
    name: m.metadata.name,
    role: m.metadata.labels?.["cluster.x-k8s.io/control-plane"] !== undefined ? ("control-plane" as const) : ("worker" as const),
    instance: spec.infrastructureRef?.name ?? status.nodeRef?.name ?? "",
    phase: status.phase ?? "Pending",
    version: spec.version ?? "",
    ready: status.conditions?.find((c) => c.type === "Ready")?.status === "True",
  };
}

export function kubernetesRoutes({ db, authz, acl, kube, k8sPorts, workloadKube = kubeFromKubeconfig }: { db: Db; authz: Authz; acl: Acl; kube?: Kube; k8sPorts?: [number, number]; workloadKube?: (kubeconfig: string) => Kube }) {
  const ports = k8sPorts ?? DEFAULT_PORTS;
  const enabled = (): Kube => {
    if (!kube) throw new ApiError(409, "kubernetes_disabled", "Kubernetes is not enabled: IncusCloud has no management cluster (IC_K8S_KUBECONFIG)");
    return kube;
  };
  /** A privilege on a Kubernetes cluster (`/tenants/<t>/kubernetes/<name>`); whoever created it owns it. */
  const may = (p: Principal, privilege: Privilege, x: { row: typeof k8sClusters.$inferSelect; tenantSlug: string }) =>
    acl.can(p, privilege, `/tenants/${x.tenantSlug}/kubernetes/${x.row.name}`, { owner: x.row.createdBy });
  const need = async (p: Principal, privilege: Privilege, x: Parameters<typeof may>[2]) => {
    if (!(await may(p, privilege, x))) throw forbidden();
  };
  const select = (where?: ReturnType<typeof and>) =>
    db
      .select({ row: k8sClusters, tenantSlug: tenants.slug, clusterName: clusters.name, project: sql<string>`coalesce(${placements.project}, ${tenants.slug})` })
      .from(k8sClusters)
      .innerJoin(tenants, eq(tenants.id, k8sClusters.tenantId))
      .innerJoin(clusters, eq(clusters.id, k8sClusters.clusterId))
      .leftJoin(placements, and(eq(placements.tenantId, k8sClusters.tenantId), eq(placements.clusterId, k8sClusters.clusterId)))
      .where(where)
      .orderBy(tenants.slug, k8sClusters.name);
  const load = async (p: Principal, id: string) => {
    enabled();
    const [found] = await select(eq(k8sClusters.id, uuidParam(id, "Kubernetes cluster not found")));
    if (!found || !(await may(p, "k8s.view", found))) throw notFound("Kubernetes cluster not found");
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
        /** What the create form starts from. */
        defaults: specFromSize("medium"),
      };
    })
    .get(
      "/api/v1/kubernetes",
      async ({ principal, query }) => {
        const p = authed(principal);
        enabled();
        const rows = await select(query.tenant ? eq(k8sClusters.tenantId, uuidParam(query.tenant)) : undefined);
        return (await filterAsync(rows, (x) => may(p, "k8s.view", x))).map((x) => view(x.row, x.tenantSlug, x.clusterName, x.project));
      },
      { query: t.Object({ tenant: t.Optional(t.String()) }) },
    )
    .get("/api/v1/kubernetes/:id", async ({ principal, params }) => {
      const x = await load(authed(principal), params.id);
      return view(x.row, x.tenantSlug, x.clusterName, x.project);
    })
    .post(
      "/api/v1/kubernetes",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        enabled();
        const ids = await acl.lookup();
        const slug = ids.tenantSlugs.get(body.tenantId);
        if (!slug || !(await acl.can(p, "tenant.view", `/tenants/${slug}`))) throw notFound();
        if (!(await acl.can(p, "k8s.provision", `/tenants/${slug}`))) throw forbidden();
        if (body.size && body.spec) throw new ApiError(400, "invalid_request", "Give a size or a spec, not both");
        const size: Size | null = body.spec ? null : (body.size ?? "medium");
        const given = body.spec as K8sSpec | undefined;
        const why = given ? specError(given) : null;
        if (why) throw new ApiError(400, "invalid_request", why);
        const req = usageOfSpec(given ?? specFromSize(size!), body.controlPlanes, body.workers);
        // Operators create on any ready cluster: the tenant is placed there first, and the job waits for its project.
        const operator = await acl.can(p, "cluster.configure", `/clusters/${ids.clusterNames.get(body.clusterId) ?? ""}`);
        let placedNow = false;
        const r = await audited(db, { principal: p, request }, "kubernetes.create", { type: "tenant", id: body.tenantId }, () =>
          // One quota decision at a time per tenant, and one port choice at a time per cluster.
          db.transaction(async (tx) => {
            const txDb = tx as unknown as Db;
            await lockTenant(txDb, body.tenantId);
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`k8s-endpoint:${body.clusterId}`}))`);
            const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, body.tenantId));
            if (!tenant) throw notFound();
            await needKubernetesQuota(txDb, tenant.id, tenant.quotas);
            // Each node is an instance: the per-instance maximums hold for its flavors.
            const spec = given ?? specFromSize(size!);
            for (const f of [spec.controlPlane.flavor, spec.worker.flavor]) {
              const one = usageOfSpec({ ...spec, controlPlane: { ...spec.controlPlane, flavor: f } } as K8sSpec, 1, 0, { lb: false });
              needInstanceCaps(tenant.quotas, one);
            }
            const [placed] = await tx
              .select({ project: placements.project, status: placements.status, clusterName: clusters.name })
              .from(placements)
              .innerJoin(clusters, eq(clusters.id, placements.clusterId))
              .where(and(eq(placements.tenantId, tenant.id), eq(placements.clusterId, body.clusterId)));
            let clusterName = placed?.clusterName;
            if (!placed) {
              if (!operator) throw new ApiError(409, "not_placed", "The tenant is not placed on that cluster");
              const [c] = await tx.select({ name: clusters.name, status: clusters.status }).from(clusters).where(eq(clusters.id, body.clusterId));
              if (!c) throw notFound("No such cluster");
              if (c.status !== "ready") throw new ApiError(409, "cluster_not_ready", `${c.name} is not ready`);
              await tx.insert(placements).values({ tenantId: tenant.id, clusterId: body.clusterId, project: tenant.slug });
              clusterName = c.name;
              placedNow = true;
            } else if (placed.status !== "ready" && !operator) {
              throw new ApiError(409, "not_ready", `The tenant's project on ${placed.clusterName} is not ready yet`);
            }
            const [taken] = await tx.select({ id: k8sClusters.id }).from(k8sClusters).where(and(eq(k8sClusters.tenantId, tenant.id), eq(k8sClusters.name, body.name)));
            if (taken) throw new ApiError(409, "conflict", `A Kubernetes cluster named "${body.name}" already exists in ${tenant.slug}`);
            const usage = await tx.select({ usage: placements.usage }).from(placements).where(eq(placements.tenantId, tenant.id));
            const over = exceeds(tenant.quotas, sumUsage([...usage.map((x) => x.usage), await pendingOf(txDb, tenant.id)]), req);
            if (over.length) throw new ApiError(409, "quota_exceeded", `Over the tenant's quota: ${over.join(", ")}`);
            const ep = given && !lbIsInstance(given.loadBalancer) ? await vipEndpoint(txDb, body.clusterId, given.loadBalancer.host, body.member) : await pickEndpoint(txDb, body.clusterId, ports, lbMemberOf(given) ?? body.member);
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
                size,
                // A size's spec is pinned to the member the endpoint chose (as before specs).
                spec: given ? pinned(given, ep.member) : specFromSize(size!, ep.member),
                endpointHost: ep.host,
                endpointPort: ep.port,
                lbMember: ep.member,
                createdBy: `${p.kind}:${p.id}`,
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
            return { cluster: view(row!, tenant.slug, clusterName!, placed?.project ?? tenant.slug), job };
          }),
        (r) => ({ k8sId: r.cluster.id, name: r.cluster.name }),
        );
        if (placedNow) {
          await authz.write([tuples.placement(body.tenantId, body.clusterId)]);
          await requestReconcile(db, [body.clusterId]);
        }
        set.status = 202;
        return r;
      },
      {
        body: t.Object({
          tenantId: t.String({ format: "uuid" }),
          clusterId: t.String({ format: "uuid" }),
          name: t.String({ pattern: NAME }),
          version: t.Union(KUBERNETES_VERSIONS.map((v) => t.Literal(v))),
          controlPlanes: ControlPlanes,
          workers: t.Integer({ minimum: 0, maximum: 20 }),
          /** Clusters as before specs; neither size nor spec is a medium one. */
          size: t.Optional(t.Union((Object.keys(SIZES) as Size[]).map((s) => t.Literal(s)))),
          spec: t.Optional(Spec),
          /** On a multi-member Incus cluster: the member to run on (default: the one with most memory free). */
          member: t.Optional(t.String({ minLength: 1, maxLength: 253 })),
        }),
      },
    )
    .patch(
      "/api/v1/kubernetes/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        const x = await load(p, params.id);
        const { row, tenantSlug, clusterName, project } = x;
        await need(p, "k8s.provision", x);
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
            const before = usageOfSpec(cur.spec, cur.controlPlanes, cur.workers, { lb: false });
            const after = usageOfSpec(cur.spec, next.controlPlanes, next.workers, { lb: false });
            const grow = Object.fromEntries(Object.keys(after).map((k) => [k, Math.max(0, after[k as keyof Usage] - before[k as keyof Usage])])) as unknown as Usage;
            if (grow.instances > 0) {
              const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, cur.tenantId));
              const usage = await tx.select({ usage: placements.usage }).from(placements).where(eq(placements.tenantId, cur.tenantId));
              const over = exceeds(tenant!.quotas, sumUsage([...usage.map((x) => x.usage), await pendingOf(txDb, cur.tenantId)]), grow);
              if (over.length) throw new ApiError(409, "quota_exceeded", `Over the tenant's quota: ${over.join(", ")}`);
            }
            const [saved] = await tx.update(k8sClusters).set(next).where(eq(k8sClusters.id, cur.id)).returning();
            // Our ClusterClass first: a cluster made before it last changed may use variables only the new one has.
            for (const obj of classBundle()) await enabled().apply(obj);
            // On the class it has: moving it to a newer one would roll its machines.
            const existing = await enabled().get("cluster.x-k8s.io/v1beta2", "Cluster", saved!.namespace, saved!.name);
            const className = (existing?.spec as { topology?: { classRef?: { name?: string } } } | undefined)?.topology?.classRef?.name;
            await enabled().apply(clusterManifest({ ...saved!, className, secretName: secretNameOf({ name: clusterName }) }));
            return saved!;
          }),
        (s) => ({ k8sId: s.id, version: s.version, controlPlanes: s.controlPlanes, workers: s.workers }),
        );
        return view(updated, tenantSlug, clusterName, project);
      },
      {
        body: t.Object({
          version: t.Optional(t.Union(KUBERNETES_VERSIONS.map((v) => t.Literal(v)))),
          controlPlanes: t.Optional(ControlPlanes),
          workers: t.Optional(t.Integer({ minimum: 0, maximum: 20 })),
        }),
      },
    )
    .delete("/api/v1/kubernetes/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      const x = await load(p, params.id);
      const { row } = x;
      await need(p, "k8s.delete", x);
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
    .get("/api/v1/kubernetes/:id/nodes", async ({ principal, params }) => {
      const { row } = await load(authed(principal), params.id);
      const machines = await asked(() => enabled().list(MACHINE_API, "Machine", row.namespace, `cluster.x-k8s.io/cluster-name=${row.name}`));
      return machines.map(nodeOf).sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "control-plane" ? -1 : 1));
    })
    .get("/api/v1/kubernetes/:id/status", async ({ principal, params }) => {
      const { row } = await load(authed(principal), params.id);
      const cluster = await asked(() => enabled().get(MACHINE_API, "Cluster", row.namespace, row.name));
      const st = (cluster?.status ?? {}) as { phase?: string; conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }> };
      const conditions = (st.conditions ?? []).map((c) => ({ type: c.type, status: c.status, reason: c.reason ?? "", message: c.message ?? "", lastTransitionTime: c.lastTransitionTime ?? "" }));
      // Why it is not available yet: CAPI's aggregated condition, else the control plane's.
      const down = ["Available", "ControlPlaneAvailable"].map((t) => conditions.find((c) => c.type === t)).find((c) => c && c.status !== "True");
      return { phase: st.phase ?? (cluster ? "" : "Missing"), message: down?.message || down?.reason || "", endpoint: endpointOf(row), conditions };
    })
    .get("/api/v1/kubernetes/:id/activity", async ({ principal, params }) => {
      const { row } = await load(authed(principal), params.id);
      // Events on its own objects: the Cluster and everything CAPI names after it,
      // but not a sibling's whose name starts with this one's ("web" and "web-prod").
      const events = (await asked(() => enabled().list("v1", "Event", row.namespace))) as unknown as NonNullable<K8sEventList["items"]>;
      const siblings = (await db.select({ name: k8sClusters.name }).from(k8sClusters).where(eq(k8sClusters.tenantId, row.tenantId)))
        .map((s) => s.name)
        .filter((n) => n.length > row.name.length && n.startsWith(`${row.name}-`));
      const ours = (n: string) => n === row.name || n.startsWith(`${row.name}-`);
      const sibling = (n: string) => siblings.some((s) => n === s || n.startsWith(`${s}-`));
      const names = new Set(events.map((e) => e.involvedObject?.name ?? "").filter((n) => ours(n) && !sibling(n)));
      const fromEvents = eventActivity({ items: events }, names, new Date(row.createdAt.getTime() - 60_000));
      const ran = await db.select().from(jobs).where(jobFor(row.id)).orderBy(sql`${jobs.createdAt} desc`).limit(50);
      const fromJobs: ActivityEntry[] = ran.map((j) => ({
        time: (j.finishedAt ?? j.startedAt ?? j.createdAt).toISOString(),
        level: j.state === "failed" ? "error" : "info",
        source: "incuscloud",
        object: j.type,
        message: [`${j.type} ${j.state}`, j.progress?.message ? `${j.progress.stage}: ${j.progress.message}` : "", j.error].filter(Boolean).join(" — "),
        count: 1,
      }));
      return { entries: mergeActivity([fromEvents, fromJobs], 300) };
    })
    .get("/api/v1/kubernetes/:id/metallb", async ({ principal, params }) => {
      const { row } = await load(authed(principal), params.id);
      const requested = row.spec.metallb?.addresses ?? null;
      const text = await workloadKubeconfig(enabled(), row.namespace, row.name);
      if (!text) return { requested, installed: false, ready: false, addresses: [], message: `The kubeconfig of ${row.name} is not available yet` };
      try {
        return { requested, ...(await metallbState(workloadKube(text))), message: "" };
      } catch (e) {
        return { requested, installed: false, ready: false, addresses: [], message: `${row.name} did not answer: ${(e as Error).message}` };
      }
    })
    .put(
      "/api/v1/kubernetes/:id/metallb",
      async ({ principal, request, params, body, set }) => {
        const p = authed(principal);
        const x = await load(p, params.id);
        const { row, tenantSlug, clusterName, project } = x;
        await need(p, "k8s.provision", x);
        const addresses = body.addresses.map((a) => a.trim());
        const bad = addresses.find((a) => parseRange(a) === null);
        if (bad !== undefined) throw new ApiError(400, "invalid_request", `"${bad}" is not an IPv4 range (a.b.c.d-e.f.g.h), CIDR or address`);
        const r = await audited(db, { principal: p, request }, "kubernetes.metallb", { type: "tenant", id: row.tenantId }, () =>
          db.transaction(async (tx) => {
            const spec = { ...row.spec, metallb: addresses.length ? { addresses } : null };
            const [saved] = await tx.update(k8sClusters).set({ spec }).where(eq(k8sClusters.id, row.id)).returning();
            const job = await enqueueJob(tx as unknown as Db, { type: "k8s-metallb", payload: { k8sId: row.id, name: row.name }, actor: { type: p.kind, id: p.id }, tenantId: row.tenantId, clusterIds: [row.clusterId] });
            return { cluster: view(saved!, tenantSlug, clusterName, project), job };
          }),
        (r) => ({ k8sId: r.cluster.id, addresses }),
        );
        set.status = 202;
        return r;
      },
      { body: t.Object({ addresses: t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 }) }) },
    )
    .get("/api/v1/kubernetes/:id/kubeconfig", async ({ principal, request, params }) => {
      const p = authed(principal);
      const x = await load(p, params.id);
      const { row } = x;
      await need(p, "k8s.kubeconfig", x);
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
