import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { z } from "zod";
import { env } from "../env.ts";
import { FLAVORS } from "../constants.ts";
import { clusterStore, type ClusterRecord } from "../lib/store.ts";
import {
  createProject,
  deleteProject,
  suggestProjectName,
} from "../lib/projects.ts";
import { incusErrorDetail } from "../lib/incus.ts";
import { log } from "../lib/log.ts";

const CreateClusterBody = z.object({
  name: z.string().min(1).max(63),
  flavor: z.enum(FLAVORS).default("default"),
  kubernetesVersion: z.string().default("v1.37.0"),
  controlPlaneCount: z.number().int().min(1).max(9).default(1),
  workerCount: z.number().int().min(0).max(100).default(1),
  project: z.string().optional(),
});

/**
 * Cluster lifecycle API. All routes require the shared agent bearer token.
 * Provisioning is stubbed: specs are recorded so the UI flow can be built out
 * before the CAPN hand-off lands.
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
  .get("/", () => ({ clusters: clusterStore.list() }), {
    detail: {
      summary: "List managed clusters",
      tags: ["clusters"],
      security: [{ bearerAuth: [] }],
    },
  })
  .post(
    "/",
    async ({ body, set }) => {
      const project =
        body.project ?? suggestProjectName("workload", body.name);
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
        log.error(`create cluster: failed to create project '${project}': ${detail}`);
        set.status = 502;
        return { error: "failed to create cluster project", detail };
      }
      const record: ClusterRecord = {
        id: crypto.randomUUID(),
        name: body.name,
        flavor: body.flavor,
        kubernetesVersion: body.kubernetesVersion,
        controlPlaneCount: body.controlPlaneCount,
        workerCount: body.workerCount,
        project,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      clusterStore.create(record);
      // TODO: hand the desired spec off to CAPN (clusterctl generate | apply)
      // once the operator VM's management cluster is reachable.
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
    "/:id",
    ({ params, set }) => {
      const record = clusterStore.get(params.id);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      return record;
    },
    {
      detail: {
        summary: "Get a cluster by id",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      const record = clusterStore.get(params.id);
      if (!record) {
        set.status = 404;
        return { error: "not found" };
      }
      // One-shot teardown: deleting the project takes its instances/networks
      // /profiles with it. TODO: delete the CAPI Cluster first once wired.
      if (record.project) await deleteProject(record.project);
      clusterStore.delete(params.id);
      set.status = 200;
      return { deleted: params.id, project: record.project };
    },
    {
      detail: {
        summary: "Delete a cluster",
        tags: ["clusters"],
        security: [{ bearerAuth: [] }],
      },
    },
  );
