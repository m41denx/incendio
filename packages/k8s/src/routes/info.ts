import { Elysia } from "elysia";
import { AGENT, FLAVORS, ROLES } from "../constants.ts";
import { env } from "../env.ts";
import { serverCertFingerprint } from "../lib/tls.ts";
import { capnReady } from "../lib/capi.ts";

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
    async () => ({
      name: AGENT.name,
      version: AGENT.version,
      apiVersion: AGENT.apiVersion,
      capabilities: {
        // The agent is a thin broker over CAPI; it does not reconcile.
        // `operator`/`projects` are wired to the Incus API; `capn` reflects a
        // live probe of the CAPN controller in the mgmt k3s cluster — true
        // only when the agent can actually generate|apply workload clusters.
        capn: await capnReady(),
        // Day-2 features the UI gates on (absent on older agents).
        upgrade: true,
        activity: true,
        operator: true,
        projects: true,
        flavors: FLAVORS,
        roles: ROLES,
      },
      incus: {
        apiUrl: env.INCUS_API_URL,
        configured: env.INCUS_API_URL.length > 0,
      },
      // Self-signed cert identity so the UI can pin the appliance on approval.
      tls: { fingerprint: serverCertFingerprint() },
    }),
    { detail: { summary: "Agent handshake / capability discovery", tags: ["meta"] } },
  );
