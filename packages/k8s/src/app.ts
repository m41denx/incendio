import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { openapi } from "@elysiajs/openapi";
import { env } from "./env.ts";
import { AGENT } from "./constants.ts";
import { infoRoutes } from "./routes/info.ts";
import { clusterRoutes } from "./routes/clusters.ts";

/**
 * Assembles the agent HTTP app: CORS for the browser UI, OpenAPI docs, JWT
 * signing, and the versioned route groups.
 *
 * There is deliberately no reconcile loop here: the agent is a thin broker over
 * the CAPI/CAPN control plane, and CAPI's controllers own all reconciliation
 * (see docs/k8s/deploy-model.md §4). The agent only reads status on demand.
 */
export const app = new Elysia()
  .use(
    cors({
      origin:
        env.CORS_ORIGIN === "*"
          ? true
          : env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  )
  .use(
    openapi({
      documentation: {
        info: { title: "Incendio Kubernetes agent", version: AGENT.version },
        tags: [
          { name: "meta", description: "Handshake and health" },
          { name: "clusters", description: "Kubernetes cluster lifecycle" },
        ],
      },
    }),
  )
  .use(jwt({ name: "jwt", secret: env.JWT_SECRET }))
  .use(infoRoutes)
  .use(clusterRoutes);

export type App = typeof app;
