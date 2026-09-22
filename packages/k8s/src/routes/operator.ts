import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { z } from "zod";
import { env } from "../env.ts";
import { createProject, listManagedProjects } from "../lib/projects.ts";
import {
  createOperatorVm,
  listInstances,
  readAgentCredentials,
} from "../lib/operator.ts";

const DEFAULT_MGMT_PROJECT = "incendio-mgmt";
const DEFAULT_OPERATOR_NAME = "operator";
const DEFAULT_K8S_VERSION = "v1.31.0";

const DeployOperatorBody = z.object({
  name: z.string().min(1).max(63).default(DEFAULT_OPERATOR_NAME),
  project: z.string().min(1).max(63).default(DEFAULT_MGMT_PROJECT),
  kubernetesVersion: z.string().default(DEFAULT_K8S_VERSION),
  imageAlias: z.string().optional(),
  imageServer: z.string().optional(),
  cpu: z.number().int().min(1).max(64).default(2),
  memoryGiB: z.number().int().min(1).max(256).default(4),
  target: z.string().optional(),
  agentDownloadUrl: z.string().optional(),
});

/**
 * Operator-appliance lifecycle. The operator VM is the vCenter/VCSA of our
 * model: it hosts the management cluster + this agent. It is created through
 * the plain Incus API (no CAPI exists yet). See docs/k8s/deploy-model.md §4.
 */
export const operatorRoutes = new Elysia({ prefix: "/v1/operator" })
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
    async ({ set }) => {
      const mgmt = await listManagedProjects("management");
      if (mgmt.length === 0) return { exists: false };
      const project = mgmt[0]!.name;
      let instances: { name: string; status?: string; type?: string }[] = [];
      try {
        instances = (await listInstances(project)).map((i) => ({
          name: i.name,
          status: i.status,
          type: i.type,
        }));
      } catch {
        set.status = 502;
        return { exists: true, project, error: "failed to list instances" };
      }
      return { exists: true, project, instances };
    },
    {
      detail: {
        summary: "Operator appliance status",
        tags: ["operator"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    "/",
    async ({ body, set }) => {
      let creds;
      try {
        creds = readAgentCredentials();
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }

      await createProject(body.project, {
        role: "management",
        cluster: "mgmt",
        k8sVersion: body.kubernetesVersion,
        operator: body.name,
      });

      try {
        const operation = await createOperatorVm({
          name: body.name,
          project: body.project,
          kubernetesVersion: body.kubernetesVersion,
          imageAlias: body.imageAlias,
          imageServer: body.imageServer,
          cpu: body.cpu,
          memoryGiB: body.memoryGiB,
          target: body.target,
          agentToken: env.AGENT_TOKEN,
          jwtSecret: env.JWT_SECRET,
          corsOrigin: env.CORS_ORIGIN,
          incusApiUrl: env.INCUS_API_URL,
          clientCrt: creds.clientCrt,
          clientKey: creds.clientKey,
          serverCrt: creds.serverCrt,
          agentDownloadUrl: body.agentDownloadUrl,
        });
        set.status = 202;
        return { project: body.project, name: body.name, operation };
      } catch (error) {
        set.status = 502;
        return {
          project: body.project,
          error: "failed to launch operator VM",
          detail: (error as Error).message,
        };
      }
    },
    {
      body: DeployOperatorBody,
      detail: {
        summary: "Deploy the operator appliance VM (mgmt project + kubeadm VM)",
        tags: ["operator"],
        security: [{ bearerAuth: [] }],
      },
    },
  );
