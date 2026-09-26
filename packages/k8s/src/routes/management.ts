import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { env } from "../env.ts";
import { incusErrorDetail } from "../lib/incus.ts";
import { controllerHealth, restartControllers, RestartInProgress } from "../lib/self-heal.ts";

/**
 * The management cluster's own Cluster API controllers: their health and a
 * restart for when they are stuck (lib/self-heal.ts).
 */
export const managementRoutes = new Elysia({ prefix: "/v1/management" })
  .use(bearer())
  .onBeforeHandle(({ bearer, set }) => {
    if (!bearer || bearer !== env.AGENT_TOKEN) {
      set.status = 401;
      set.headers["www-authenticate"] = 'Bearer realm="incendio-k8s"';
      return { error: "unauthorized" };
    }
  })
  .get(
    "/controllers",
    async ({ set }) => {
      try {
        return await controllerHealth();
      } catch (error) {
        set.status = 502;
        return { error: "failed to read the controllers", detail: incusErrorDetail(error) };
      }
    },
    {
      detail: {
        summary: "Cluster API controller health, unreachable nodes and the last restart",
        tags: ["management"],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    "/controllers/restart",
    ({ set }) => {
      try {
        set.status = 202;
        return restartControllers("requested from the UI", false);
      } catch (error) {
        if (error instanceof RestartInProgress) {
          set.status = 409;
          return { error: error.message };
        }
        throw error;
      }
    },
    {
      detail: {
        summary: "Restart the Cluster API controllers (in the background)",
        tags: ["management"],
        security: [{ bearerAuth: [] }],
      },
    },
  );
