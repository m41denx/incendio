import { Elysia } from "elysia";
import { errorHandling } from "./lib/errors.ts";
import type { Authz } from "./authz/platform.ts";
import { principalPlugin } from "./auth/principal.ts";
import { sessionRoutes, type AuthDeps } from "./auth/session.ts";
import { identityRoutes } from "./identity/routes.ts";
import { meRoutes } from "./api/me.ts";
import { usersRoutes } from "./api/users.ts";
import { tenantsRoutes } from "./api/tenants.ts";
import { serviceAccountsRoutes } from "./api/service-accounts.ts";
import { clustersRoutes } from "./api/clusters.ts";
import { auditRoutes } from "./api/audit.ts";
import { fleetRoutes } from "./api/fleet.ts";
import { gatewayLogRoutes } from "./api/gateway-log.ts";

/** Everything the HTTP app needs. */
export interface AppDeps extends AuthDeps {
  authz: Authz;
  /** Clusters are `<name>.<clusterDomain>` for API clients (spec D11). */
  clusterDomain: string;
}

/** The platform's HTTP app: identity pages, sessions, platform API, health. */
export function createApp(deps: AppDeps) {
  return new Elysia()
    .use(errorHandling)
    .get("/healthz", () => ({ status: "ok" }))
    .use(principalPlugin(deps))
    .use(identityRoutes({ db: deps.db, hydra: deps.hydra, secureCookies: deps.secureCookies }))
    .use(sessionRoutes(deps))
    .use(meRoutes(deps))
    .use(usersRoutes(deps))
    .use(tenantsRoutes(deps))
    .use(serviceAccountsRoutes(deps))
    .use(clustersRoutes(deps))
    .use(auditRoutes(deps))
    .use(gatewayLogRoutes(deps))
    .use(fleetRoutes(deps));
}
