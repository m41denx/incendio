import { Elysia } from "elysia";
import { AGENT, FLAVORS, ROLES } from "../constants.ts";
import { env } from "../env.ts";

/**
 * Public, unauthenticated discovery endpoints. The UI calls GET /v1/info during
 * its agent handshake to learn the API version and available capabilities.
 */
export const infoRoutes = new Elysia()
  .get("/health", () => ({ status: "ok" }), {
    detail: { summary: "Liveness probe", tags: ["meta"] },
  })
  .get(
    "/v1/info",
    () => ({
      name: AGENT.name,
      version: AGENT.version,
      apiVersion: AGENT.apiVersion,
      capabilities: {
        // CAPN orchestration is not wired yet (see docs/k8s/README.md). The
        // agent is a thin broker over CAPI; it does not reconcile.
        capn: false,
        flavors: FLAVORS,
        roles: ROLES,
      },
      incus: {
        apiUrl: env.INCUS_API_URL,
        configured: env.INCUS_API_URL.length > 0,
      },
    }),
    { detail: { summary: "Agent handshake / capability discovery", tags: ["meta"] } },
  );
