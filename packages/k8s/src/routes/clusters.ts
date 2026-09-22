import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { z } from "zod";
import { env } from "../env.ts";
import { FLAVORS } from "../constants.ts";
import {
  createProject,
  deleteProject,
  suggestProjectName,
} from "../lib/projects.ts";
import { incusErrorDetail } from "../lib/incus.ts";
import { log } from "../lib/log.ts";
import { auditRepo, clusterRepo, deriveStatus } from "../db/repo.ts";

const CreateClusterBody = z.object({
  name: z.string().min(1).max(63),
  // `flavor` is retained for backward compatibility (the UI no longer sends it
  // now that the generator is default-template-only) and folded into spec_json.
  flavor: z.enum(FLAVORS).default("default"),
  kubernetesVersion: z.string().default("v1.37.0"),
  controlPlaneCount: z.number().int().min(1).max(9).default(1),
  workerCount: z.number().int().min(0).max(100).default(1),
  project: z.string().optional(),
});

/**
 * Cluster lifecycle API. All routes require the shared agent bearer token.
 *
 * Reads come from the sqlite cache (docs/k8s/management-appliance.md §6); the
 * CAPI/CAPN CRDs stay authoritative and will refresh the cache once wired
 * (/v1/info reports capn:false today). Clusters are addressed by name to match
 * CAPI Cluster identity.
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
  .get("/", () => ({ clusters: clusterRepo.list() }), {
    detail: {
      summary: "List managed clusters (from the sqlite cache)",
      tags: ["clusters"],
      security: [{ bearerAuth: [] }],
    },
  })
  .post(
    "/",
    async ({ body, set }) => {
      if (clusterRepo.getByName(body.name)) {
        set.status = 409;
        return { error: "cluster already exists", name: body.name };
      }
      const project = body.project ?? suggestProjectName("workload", body.name);
      log.info(
        `create cluster: name=${body.name} project=${project} flavor=${body.flavor} k8s=${body.kubernetesVersion} cp=${body.controlPlaneCount} workers=${body.workerCount}`,
      );
      try {
        // Project-per-workload-cluster: stamp user.incendio.* metadata so the
        // cluster is detectable and teardown is one delete.
        await createProject(project, {
          role: "workload",
          cluster: body.name,
          k8sVersion: body.kubernetesVersion,
        });
        log.info(`create cluster: project '${project}' ready`);
      } catch (error) {
        const detail = incusErrorDetail(error);
        log.error(
          `create cluster: failed to create project '${project}': ${detail}`,
        );
        set.status = 502;
        return { error: "failed to create cluster project", detail };
      }
      const record = clusterRepo.create({
        name: body.name,
        project,
        kubernetesVersion: body.kubernetesVersion,
        controlPlaneCount: body.controlPlaneCount,
        workerCount: body.workerCount,
        status: "pending",
        spec: body,
      });
      auditRepo.record(
        "cluster.create",
        `name=${body.name} project=${project}`,
      );
      // TODO: hand the desired spec off to CAPN (clusterctl generate | apply)
      // once the mgmt k3s cluster is reachable; return a task id then.
      set.status = 201;
      return record;
    },
    {
      body: CreateClusterBody,
      detail: {
        summary:
          "Create a cluster: stamps the per-cluster Incus project (CAPN apply pending)",
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
    ({ params, set }) => {
      const record = clusterRepo.getByName(params.name);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      // Derived from the cache today; becomes CRD-sourced once CAPN is wired.
      return deriveStatus(record);
    },
    {
      detail: {
        summary: "Cluster status for SWR polling (cache-derived until CAPN)",
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
      // One-shot teardown: deleting the project takes its instances/networks
      // /profiles with it. TODO: delete the CAPI Cluster first once wired.
      if (record.project) await deleteProject(record.project);
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
        summary: "Delete a cluster (one-shot project teardown)",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  );
