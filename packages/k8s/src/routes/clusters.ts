import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { z } from "zod";
import { env } from "../env.ts";
import { FLAVORS } from "../constants.ts";
import { TemplateVariables } from "../lib/template-vars.ts";
import { ClusterPatchBody, PatchRejected } from "../lib/cluster-patch.ts";
import { customImageError } from "../lib/upgrade.ts";
import { nextStatus } from "../lib/lifecycle.ts";
import { MetalLBBody, outsideSubnet, overlapping } from "../lib/metallb.ts";
import {
  forgetJob,
  hasKubeconfig,
  metallbStatus,
  NoKubeconfigError,
  startInstall,
  startRemove,
} from "../lib/metallb-ops.ts";
import { metallbNetworkHint } from "../lib/network-hint.ts";
import { pinClusterEndpoint } from "../lib/endpoint-ops.ts";
import { endpointProblem, manifestList, parseManifest } from "../lib/endpoint-pin.ts";
import {
  createProject,
  deleteProject,
  ensureWorkloadProfile,
  resolveWorkloadResources,
  suggestProjectName,
} from "../lib/projects.ts";
import { incusErrorDetail } from "../lib/incus.ts";
import { log } from "../lib/log.ts";
import {
  applyIdentitySecret,
  capnReady,
  deleteClusterCrd,
  getClusterActivity,
  getKubeconfig,
  patchCluster,
  generateCluster,
  getLiveStatuses,
  kubectlApply,
  secretNameFor,
  type LiveStatus,
} from "../lib/capi.ts";
import {
  auditRepo,
  clusterRepo,
  deriveStatus,
  type ClusterStatusView,
  type ClusterView,
} from "../db/repo.ts";
import type { ClusterStatus } from "../db/schema.ts";

const CreateClusterBody = z.object({
  name: z.string().min(1).max(63),
  // `flavor` is retained for backward compatibility (the UI no longer sends it
  // now that the generator is default-template-only) and folded into spec_json.
  flavor: z.enum(FLAVORS).default("default"),
  kubernetesVersion: z.string().default("v1.37.0"),
  controlPlaneCount: z.number().int().min(1).max(9).default(1),
  workerCount: z.number().int().min(0).max(100).default(1),
  project: z.string().optional(),
  // Every other form option, as CAPN template variables (unknown keys → 400).
  variables: TemplateVariables.default({}),
  // Install MetalLB with these addresses once the cluster is first ready.
  metallb: MetalLBBody.optional(),
});

/** MetalLB addresses the cluster should have (create option or later PUT). */
function wantedMetalLB(record: ClusterView): string[] | undefined {
  const spec = record.spec as { metallb?: { addresses?: string[] } } | null;
  return spec?.metallb?.addresses;
}

/** The API endpoint address the agent pinned for the cluster at create. */
function pinnedEndpoint(record: ClusterView): string | undefined {
  return (record.spec as { endpointHost?: string } | null)?.endpointHost;
}

/**
 * Addresses the network does not know are spoken for: other clusters' MetalLB
 * pools and every pinned API endpoint (a stopped load balancer holds no lease).
 */
function reservedAddresses(except: string | undefined): string[] {
  return [
    ...otherPools(except).flatMap((p) => p.addresses),
    ...clusterRepo.list().flatMap((c) => pinnedEndpoint(c) ?? []),
  ];
}

/** Every other cluster's MetalLB pool, with the owning cluster's name. */
function otherPools(except: string | undefined): { cluster: string; addresses: string[] }[] {
  return clusterRepo
    .list()
    .filter((c) => c.name !== except)
    .map((c) => ({ cluster: c.name, addresses: wantedMetalLB(c) ?? [] }))
    .filter((p) => p.addresses.length > 0);
}

/** Why `addresses` would collide with another cluster's pool, or null. */
function poolConflict(addresses: string[], except: string | undefined): string | null {
  for (const pool of otherPools(except)) {
    const clash = overlapping(addresses, pool.addresses);
    if (clash.length > 0) {
      return `${clash.join(", ")} overlaps the MetalLB pool of cluster ${pool.cluster} (${pool.addresses.join(", ")})`;
    }
  }
  for (const record of clusterRepo.list()) {
    const host = pinnedEndpoint(record);
    if (host && overlapping(addresses, [host]).length > 0) {
      return `${host} is the API endpoint of cluster ${record.name}`;
    }
  }
  return null;
}

/** Keep the cache's desired counts and version in step with the CAPI topology. */
function syncDesired(record: ClusterView, live: LiveStatus): ClusterView {
  const cp = live.controlPlaneDesired ?? record.controlPlaneCount;
  const workers = live.workerDesired ?? record.workerCount;
  const version = live.version ?? record.kubernetesVersion;
  if (
    cp === record.controlPlaneCount &&
    workers === record.workerCount &&
    version === record.kubernetesVersion
  ) {
    return record;
  }
  return (
    clusterRepo.setDesired(record.name, {
      controlPlaneCount: cp,
      workerCount: workers,
      kubernetesVersion: version,
    }) ?? record
  );
}

/** Status from the live CRDs, persisted so the next read knows the history. */
function syncStatus(record: ClusterView, live: LiveStatus): ClusterStatus {
  const status = nextStatus(record.status, live);
  if (status !== record.status) {
    clusterRepo.setStatus(record.name, status);
    // First time ready: install the add-ons requested at create time.
    const addresses = wantedMetalLB(record);
    if (status === "ready" && (record.status === "pending" || record.status === "provisioning") && addresses) {
      startInstall(record.name, addresses);
    }
  }
  return status;
}

/** Why the cluster cannot come up on its own, if the agent can tell. */
function problemOf(live: LiveStatus): string | undefined {
  return endpointProblem({
    endpoint: live.endpoint,
    available: live.available,
    haproxy: live.loadBalancer === "lxc" || live.loadBalancer === "oci",
  });
}

/**
 * Overlay live CRD status onto a cached record for list responses. When CRDs
 * are readable the status becomes CRD-sourced (and the cache is refreshed so
 * subsequent reads agree); otherwise the cached value is returned as-is.
 */
function enrich(cached: ClusterView, live: LiveStatus | undefined) {
  if (!live) return { ...cached, source: "cache" as const };
  const record = syncDesired(cached, live);
  const status = syncStatus(record, live);
  return {
    ...record,
    status,
    source: "crd" as const,
    phase: live.phase,
    message: live.message,
    endpoint: live.endpoint,
    problem: problemOf(live),
    rollout: live.rollout,
    controlPlaneReady: live.controlPlaneReady,
    workerReady: live.workerReady,
  };
}

/** Build a CRD-sourced status view (counts from Machines, desired from cache). */
function liveStatusView(
  cached: ClusterView,
  live: LiveStatus,
): ClusterStatusView {
  const record = syncDesired(cached, live);
  const status = syncStatus(record, live);
  return {
    name: record.name,
    status,
    ready: status === "ready",
    source: "crd",
    controlPlane: {
      desired: record.controlPlaneCount,
      ready: live.controlPlaneReady,
    },
    workers: { desired: record.workerCount, ready: live.workerReady },
    phase: live.phase,
    version: live.version,
    rollout: live.rollout,
    message: live.message,
    endpoint: live.endpoint,
    problem: problemOf(live),
    machines: live.machines,
    conditions: live.conditions,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Cluster lifecycle API. All routes require the shared agent bearer token.
 *
 * The CAPI/CAPN CRDs in the mgmt k3s cluster are authoritative; the sqlite
 * cache mirrors desired spec + last-seen status for fast reads and audit
 * (docs/k8s/management-appliance.md §6). Reads overlay live CRD status when the
 * CAPN controller is reachable and fall back to the cache when it is not.
 * Clusters are addressed by name to match CAPI Cluster identity.
 */
export const clusterRoutes = new Elysia({ prefix: "/v1/clusters" })
  .use(bearer())
  .onBeforeHandle(({ bearer, set }) => {
    if (!bearer || bearer !== env.AGENT_TOKEN) {
      set.status = 401;
      set.headers["www-authenticate"] = 'Bearer realm="incendio-k8s"';
      return { error: "unauthorized" };
    }
  })
  .get(
    "/",
    async () => {
      const records = clusterRepo.list();
      let live: Map<string, LiveStatus> | undefined;
      try {
        if (await capnReady()) live = await getLiveStatuses();
      } catch (error) {
        log.warn(
          `list clusters: live status unavailable: ${incusErrorDetail(error)}`,
        );
      }
      return { clusters: records.map((r) => enrich(r, live?.get(r.name))) };
    },
    {
      detail: {
        summary: "List managed clusters (live CRD status overlaid on the cache)",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    "/",
    async ({ body, set }) => {
      if (clusterRepo.getByName(body.name)) {
        set.status = 409;
        return { error: "cluster already exists", name: body.name };
      }
      const project = body.project ?? suggestProjectName("workload", body.name);
      if (body.metallb) {
        const conflict = poolConflict(body.metallb.addresses, body.name);
        if (conflict) {
          set.status = 409;
          return { error: "MetalLB addresses already in use", detail: conflict };
        }
      }
      const secretName = secretNameFor(body.name);
      log.info(
        `create cluster: name=${body.name} project=${project} k8s=${body.kubernetesVersion} cp=${body.controlPlaneCount} workers=${body.workerCount} lb=${env.LOAD_BALANCER_TYPE}`,
      );

      if (!(await capnReady())) {
        set.status = 503;
        return {
          error: "management cluster not ready",
          detail:
            "the CAPN controller is not available; deploy or repair the management appliance first",
        };
      }

      let endpointHost: string | undefined;
      try {
        // Project-per-workload-cluster: stamp user.incendio.* metadata so the
        // cluster is detectable and teardown is one delete. Then make its
        // default profile bootable (CAPN launches with profiles: [default]).
        await createProject(project, {
          role: "workload",
          cluster: body.name,
          k8sVersion: body.kubernetesVersion,
        });
        const { pool, network } = await resolveWorkloadResources();
        await ensureWorkloadProfile(project, pool, network);
        // CAPN identity secret pointing at this project, then render + apply the
        // default cluster template against the mgmt k3s cluster.
        await applyIdentitySecret(secretName, project);
        const manifest = await generateCluster({
          name: body.name,
          kubernetesVersion: body.kubernetesVersion,
          controlPlaneCount: body.controlPlaneCount,
          workerCount: body.workerCount,
          secretName,
          loadBalancer: env.LOAD_BALANCER_TYPE,
          variables: body.variables,
        });
        // A fixed IPv4 endpoint, so a dual-stack network cannot hand CAPN an
        // IPv6 one haproxy does not serve (endpoint-pin.ts).
        const pinned = await pinClusterEndpoint(parseManifest(manifest), {
          cluster: body.name,
          project,
          network,
          taken: [...reservedAddresses(body.name), ...(body.metallb?.addresses ?? [])],
        });
        endpointHost = pinned?.host;
        await kubectlApply(pinned ? manifestList(pinned.docs) : manifest);
        log.info(
          `create cluster '${body.name}': CAPN manifest applied` +
            (endpointHost ? ` (API endpoint ${endpointHost})` : ""),
        );
      } catch (error) {
        const detail = incusErrorDetail(error);
        log.error(`create cluster '${body.name}': ${detail}`);
        // Best-effort rollback so a failed create can be retried cleanly.
        await deleteClusterCrd(body.name).catch(() => undefined);
        await deleteProject(project).catch(() => undefined);
        set.status = 502;
        return { error: "failed to create cluster", detail };
      }

      const record = clusterRepo.create({
        name: body.name,
        project,
        kubernetesVersion: body.kubernetesVersion,
        controlPlaneCount: body.controlPlaneCount,
        workerCount: body.workerCount,
        status: "provisioning",
        spec: endpointHost ? { ...body, endpointHost } : body,
      });
      auditRepo.record("cluster.create", `name=${body.name} project=${project}`);
      set.status = 201;
      return record;
    },
    {
      body: CreateClusterBody,
      detail: {
        summary:
          "Create a cluster: stamp the Incus project, then clusterctl generate | kubectl apply the CAPN manifest",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/metallb-hint",
    async ({ query, set }) => {
      try {
        const record = query.cluster ? clusterRepo.getByName(query.cluster) : undefined;
        return await metallbNetworkHint(record?.project ?? null, reservedAddresses(query.cluster));
      } catch (error) {
        set.status = 502;
        return { error: "failed to read the cluster network", detail: incusErrorDetail(error) };
      }
    },
    {
      query: z.object({ cluster: z.string().optional() }),
      detail: {
        summary:
          "The Incus network a (new or existing) cluster uses and a free address block on it for MetalLB",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/:name",
    ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      return record;
    },
    {
      detail: {
        summary: "Get a cluster by name",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/:name/status",
    async ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      try {
        if (await capnReady()) {
          const live = (await getLiveStatuses()).get(params.name);
          if (live) return liveStatusView(record, live);
        }
      } catch (error) {
        log.warn(
          `status ${params.name}: live status unavailable: ${incusErrorDetail(error)}`,
        );
      }
      // Fall back to the cache when the CRDs are unreachable.
      return deriveStatus(record);
    },
    {
      detail: {
        summary: "Cluster status for SWR polling (CRD-sourced, cache fallback)",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/:name/kubeconfig",
    async ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      try {
        const kubeconfig = await getKubeconfig(params.name);
        if (kubeconfig === null) {
          set.status = 409;
          return {
            error: "kubeconfig not available yet",
            detail: "the control plane has not finished initializing",
          };
        }
        auditRepo.record("cluster.kubeconfig", `name=${params.name}`);
        return { name: params.name, kubeconfig };
      } catch (error) {
        const detail = incusErrorDetail(error);
        log.error(`kubeconfig '${params.name}': ${detail}`);
        set.status = 502;
        return { error: "failed to read kubeconfig", detail };
      }
    },
    {
      detail: {
        summary: "Admin kubeconfig of a workload cluster (CAPI <name>-kubeconfig secret)",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/:name/activity",
    async ({ params, query, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      if (!(await capnReady())) {
        set.status = 503;
        return {
          error: "management cluster not ready",
          detail: "the CAPN controller is not available; activity cannot be read now",
        };
      }
      try {
        // A little before creation: the first controller lines can precede
        // the cache row, which is written once the manifest is applied.
        const since = new Date(new Date(record.createdAt).getTime() - 120_000);
        const entries = await getClusterActivity(params.name, since, query.limit);
        return { name: params.name, entries };
      } catch (error) {
        const detail = incusErrorDetail(error);
        log.error(`activity '${params.name}': ${detail}`);
        set.status = 502;
        return { error: "failed to read cluster activity", detail };
      }
    },
    {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
      detail: {
        summary:
          "Provisioning activity: Events on the cluster's CAPI objects and the provider controllers' log lines about it, oldest first",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    "/:name/metallb",
    async ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      const wanted = wantedMetalLB(record);
      try {
        const status = await metallbStatus(params.name);
        // Requested but missing (agent restarted mid-install, or the cluster
        // came up while nobody was polling): install it now.
        if (status.state === "absent" && wanted && record.status === "ready") {
          startInstall(params.name, wanted);
          return { ...status, state: "installing", requested: wanted };
        }
        return { ...status, requested: wanted ?? null };
      } catch (error) {
        if (error instanceof NoKubeconfigError) {
          // Control plane not initialized yet: a create-time request waits.
          // (Not the cached status: a cluster that was ready and is briefly
          // unavailable still has MetalLB to report.)
          return {
            state: wanted ? "waiting" : "absent",
            addresses: [],
            services: [],
            requested: wanted ?? null,
          };
        }
        const detail = incusErrorDetail(error);
        set.status = 502;
        return { error: "failed to read MetalLB status", detail };
      }
    },
    {
      detail: {
        summary: "MetalLB in the workload cluster: state, address pool, LoadBalancer services",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .put(
    "/:name/metallb",
    async ({ params, body, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      if (!(await hasKubeconfig(params.name))) {
        set.status = 409;
        return {
          error: "cluster not initialized",
          detail: "MetalLB can be installed once the control plane is up",
        };
      }
      const conflict = poolConflict(body.addresses, params.name);
      if (conflict) {
        set.status = 409;
        return { error: "addresses already in use", detail: conflict };
      }
      try {
        const hint = await metallbNetworkHint(record.project);
        const outside = outsideSubnet(body.addresses, hint.cidr);
        if (outside.length > 0) {
          set.status = 400;
          return {
            error: "addresses outside the cluster network",
            detail: `${outside.join(", ")} not in ${hint.subnet} (network ${hint.network}); MetalLB's L2 mode can only announce addresses on the nodes' network`,
          };
        }
      } catch (error) {
        log.warn(`metallb ${params.name}: network check skipped: ${incusErrorDetail(error)}`);
      }
      const spec = (record.spec ?? {}) as Record<string, unknown>;
      clusterRepo.setSpec(params.name, { ...spec, metallb: body });
      forgetJob(params.name);
      startInstall(params.name, body.addresses);
      auditRepo.record("cluster.metallb", `name=${params.name} addresses=${body.addresses.join(",")}`);
      set.status = 202;
      return { state: "installing", requested: body.addresses };
    },
    {
      body: MetalLBBody,
      detail: {
        summary: "Install MetalLB (or change its address pool) in the workload cluster",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    "/:name/metallb",
    ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      const { metallb: _removed, ...spec } = (record.spec ?? {}) as Record<string, unknown>;
      clusterRepo.setSpec(params.name, spec);
      forgetJob(params.name);
      startRemove(params.name);
      auditRepo.record("cluster.metallb.remove", `name=${params.name}`);
      set.status = 202;
      return { state: "removing" };
    },
    {
      detail: {
        summary: "Remove MetalLB from the workload cluster",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    "/:name",
    async ({ params, body, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      if (body.kubernetesVersion !== undefined) {
        const spec = record.spec as { variables?: Record<string, string> } | null;
        const blocked = customImageError(spec?.variables);
        if (blocked) {
          set.status = 400;
          return { error: "cannot upgrade cluster", detail: blocked };
        }
      }
      if (!(await capnReady())) {
        set.status = 503;
        return {
          error: "management cluster not ready",
          detail: "the CAPN controller is not available; cannot change the cluster now",
        };
      }
      try {
        await patchCluster(params.name, body);
      } catch (error) {
        const detail = error instanceof PatchRejected ? error.message : incusErrorDetail(error);
        log.error(`update cluster '${params.name}': ${detail}`);
        set.status = error instanceof PatchRejected ? 400 : 502;
        return { error: "failed to update cluster", detail };
      }
      const updated = clusterRepo.setDesired(params.name, body) ?? record;
      // Show the rollout right away; the next status read confirms it from
      // the CRDs. A cluster still coming up stays "provisioning".
      if (updated.status === "ready" || updated.status === "scaling" || updated.status === "upgrading") {
        clusterRepo.setStatus(
          params.name,
          body.kubernetesVersion !== undefined ? "upgrading" : "scaling",
        );
      }
      const changes = [
        body.kubernetesVersion ? `version=${body.kubernetesVersion}` : null,
        body.controlPlaneCount !== undefined ? `cp=${String(body.controlPlaneCount)}` : null,
        body.workerCount !== undefined ? `workers=${String(body.workerCount)}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      auditRepo.record("cluster.update", `name=${params.name} ${changes}`);
      log.info(`update cluster '${params.name}': ${changes}`);
      return clusterRepo.getByName(params.name) ?? updated;
    },
    {
      body: ClusterPatchBody,
      detail: {
        summary:
          "Update a cluster: patch control-plane / worker replicas and/or the Kubernetes version in its CAPI topology",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    "/:name",
    async ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      try {
        // Delete the CAPI Cluster first: CAPN cascades the load balancer,
        // machines and their Incus instances, leaving the project empty so the
        // one-shot project teardown below can remove it.
        if (await capnReady()) {
          await deleteClusterCrd(params.name);
        } else {
          log.warn(
            `delete cluster '${params.name}': CAPN unavailable, deleting Incus project only`,
          );
        }
        if (record.project) await deleteProject(record.project);
      } catch (error) {
        const detail = incusErrorDetail(error);
        log.error(`delete cluster '${params.name}': ${detail}`);
        clusterRepo.setStatus(params.name, "error");
        set.status = 502;
        return { error: "failed to delete cluster", detail };
      }
      clusterRepo.deleteByName(params.name);
      forgetJob(params.name);
      auditRepo.record(
        "cluster.delete",
        `name=${params.name} project=${record.project ?? ""}`,
      );
      set.status = 200;
      return { deleted: params.name, project: record.project };
    },
    {
      detail: {
        summary: "Delete a cluster (CAPN teardown + one-shot project teardown)",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  );
