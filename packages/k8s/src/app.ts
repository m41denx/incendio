import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { openapi } from "@elysiajs/openapi";
import { env } from "./env.ts";
import { AGENT } from "./constants.ts";
import { log } from "./lib/log.ts";
import { infoRoutes } from "./routes/info.ts";
import { operatorRoutes } from "./routes/operator.ts";
import { clusterRoutes } from "./routes/clusters.ts";
import { managementRoutes } from "./routes/management.ts";

/**
 * Assembles the agent HTTP app: CORS for the browser UI, OpenAPI docs, JWT
 * signing, and the versioned route groups.
 *
 * There is deliberately no reconcile loop here: the agent is a thin broker over
 * the CAPI/CAPN control plane, and CAPI's controllers own all reconciliation
 * (see docs/k8s/deploy-model.md §4). The agent only reads status on demand;
 * its one timer is the controller watchdog (lib/self-heal.ts).
 */
export const app = new Elysia()
  .use(
    cors({
      origin:
        env.CORS_ORIGIN === "*"
          ? true
          : env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  )
  .use(
    openapi({
      documentation: {
        info: { title: "Incendio Kubernetes agent", version: AGENT.version },
        tags: [
          { name: "meta", description: "Handshake and health" },
          { name: "operator", description: "Operator appliance lifecycle" },
          { name: "clusters", description: "Kubernetes cluster lifecycle" },
          { name: "management", description: "The management cluster's controllers" },
        ],
      },
    }),
  )
  .use(jwt({ name: "jwt", secret: env.JWT_SECRET }))
  .onRequest(({ request }) => {
    log.info(`${request.method} ${new URL(request.url).pathname}`);
  })
  .onError(({ code, error, path }) => {
    log.error(
      `unhandled error (${code}) at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  })
  .use(infoRoutes)
  .use(operatorRoutes)
  .use(clusterRoutes)
  .use(managementRoutes);

export type App = typeof app;
