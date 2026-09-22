import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { z } from "zod";
import { env } from "../env.ts";
import { FLAVORS } from "../constants.ts";
import { TemplateVariables } from "../lib/template-vars.ts";
import { ScaleBody } from "../lib/scale.ts";
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
  getKubeconfig,
  scaleCluster,
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
});

/** Map a live CAPI cluster phase/availability to our cache status enum. */
function statusFromLive(live: LiveStatus): ClusterStatus {
  if (live.available) return "ready";
  if (live.phase === "Failed") return "error";
  return "provisioning";
}

/**
 * Overlay live CRD status onto a cached record for list responses. When CRDs
 * are readable the status becomes CRD-sourced (and the cache is refreshed so
 * subsequent reads agree); otherwise the cached value is returned as-is.
 */
/** Keep the cache's desired counts in step with the CAPI topology. */
function syncDesired(record: ClusterView, live: LiveStatus): ClusterView {
  const cp = live.controlPlaneDesired ?? record.controlPlaneCount;
  const workers = live.workerDesired ?? record.workerCount;
  if (cp === record.controlPlaneCount && workers === record.workerCount) {
    return record;
  }
  return (
    clusterRepo.setCounts(record.name, {
      controlPlaneCount: cp,
      workerCount: workers,
    }) ?? record
  );
}

function enrich(cached: ClusterView, live: LiveStatus | undefined) {
  if (!live) return { ...cached, source: "cache" as const };
  const record = syncDesired(cached, live);
  const status = statusFromLive(live);
  if (status !== record.status) clusterRepo.setStatus(record.name, status);
  return {
    ...record,
    status,
    source: "crd" as const,
    phase: live.phase,
    message: live.message,
    endpoint: live.endpoint,
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
  const status = statusFromLive(live);
  if (status !== record.status) clusterRepo.setStatus(record.name, status);
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
    message: live.message,
    endpoint: live.endpoint,
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
        await kubectlApply(manifest);
        log.info(`create cluster '${body.name}': CAPN manifest applied`);
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
        spec: body,
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
  .patch(
    "/:name",
    async ({ params, body, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      if (!(await capnReady())) {
        set.status = 503;
        return {
          error: "management cluster not ready",
          detail: "the CAPN controller is not available; cannot scale now",
        };
      }
      try {
        await scaleCluster(params.name, body);
      } catch (error) {
        const detail = incusErrorDetail(error);
        log.error(`scale cluster '${params.name}': ${detail}`);
        set.status = 502;
        return { error: "failed to scale cluster", detail };
      }
      const updated = clusterRepo.setCounts(params.name, body) ?? record;
      if (updated.status === "ready") {
        clusterRepo.setStatus(params.name, "provisioning");
      }
      auditRepo.record(
        "cluster.scale",
        `name=${params.name} cp=${body.controlPlaneCount ?? "-"} workers=${body.workerCount ?? "-"}`,
      );
      log.info(
        `scale cluster '${params.name}': cp=${body.controlPlaneCount ?? "unchanged"} workers=${body.workerCount ?? "unchanged"}`,
      );
      return clusterRepo.getByName(params.name) ?? updated;
    },
    {
      body: ScaleBody,
      detail: {
        summary:
          "Scale a cluster: patch control-plane / worker replicas in its CAPI topology",
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
