import { Elysia } from "elysia";
import { errorHandling } from "./lib/errors.ts";
import type { Authz } from "./authz/platform.ts";
import type { Acl } from "./acl/acl.ts";
import { principalPlugin } from "./auth/principal.ts";
import { sessionRoutes, type AuthDeps } from "./auth/session.ts";
import { identityRoutes } from "./identity/routes.ts";
import { meRoutes } from "./api/me.ts";
import { aclRoutes } from "./api/acl.ts";
import { groupsRoutes } from "./api/groups.ts";
import { identityProvidersRoutes } from "./api/identity-providers.ts";
import { requestReconcile } from "./reconcile/requests.ts";
import { usersRoutes } from "./api/users.ts";
import { tenantsRoutes } from "./api/tenants.ts";
import { serviceAccountsRoutes } from "./api/service-accounts.ts";
import { clustersRoutes } from "./api/clusters.ts";
import { accessRoutes } from "./api/access.ts";
import { auditRoutes } from "./api/audit.ts";
import { fleetRoutes } from "./api/fleet.ts";
import { mobilityRoutes, type Inspect } from "./api/mobility.ts";
import { jobsRoutes } from "./api/jobs.ts";
import { replicationRoutes } from "./api/replication.ts";
import { backupsRoutes } from "./api/backups.ts";
import { balancingRoutes, type ClientOf } from "./api/balancing.ts";
import { tenantCloudRoutes } from "./api/tenant-cloud.ts";
import { kubernetesRoutes } from "./api/kubernetes.ts";
import type { Kube } from "./k8s/kube.ts";
import type { StoreFor } from "./backups/store.ts";
import { gatewayLogRoutes } from "./api/gateway-log.ts";

/** Everything the HTTP app needs. */
export interface AppDeps extends AuthDeps {
  authz: Authz;
  /** Permissions: privileges on paths (the authorization source). */
  acl: Acl;
  /** Clusters are `<name>.<clusterDomain>` for API clients (spec D11). */
  clusterDomain: string;
  /** Reads both clusters for a migration pre-flight; tests replace it. */
  inspect?: Inspect;
  /** Opens a backup target's store; tests replace it. */
  storeFor?: StoreFor;
  /** Opens a cluster's admin client (balancing plans); tests replace it. */
  clientOf?: ClientOf;
  /** The platform UI's stylesheet, for the server-rendered sign-in pages. */
  stylesheet?: () => string | undefined;
  /** The management cluster (P10); without it Kubernetes is off. */
  kube?: Kube;
  /** Ports for workload API endpoints (IC_K8S_PORTS). */
  k8sPorts?: [number, number];
  /** Opens a workload cluster's API from its admin kubeconfig; tests replace it. */
  workloadKube?: (kubeconfig: string) => Kube;
}

/** The platform's HTTP app: identity pages, sessions, platform API, health. */
export function createApp(deps: AppDeps) {
  return new Elysia()
    .use(errorHandling)
    .get("/healthz", () => ({ status: "ok" }))
    .use(principalPlugin(deps))
    .use(
      identityRoutes({
        db: deps.db,
        hydra: deps.hydra,
        secureCookies: deps.secureCookies,
        stylesheet: deps.stylesheet,
        secretKey: deps.secretKey,
        publicUrl: deps.publicUrl,
        onGroupsChanged: async () => {
          deps.acl.invalidate();
          await requestReconcile(deps.db, "all");
        },
      }),
    )
    .use(sessionRoutes(deps))
    .use(meRoutes(deps))
    .use(aclRoutes(deps))
    .use(groupsRoutes(deps))
    .use(identityProvidersRoutes(deps))
    .use(usersRoutes(deps))
    .use(tenantsRoutes(deps))
    .use(serviceAccountsRoutes(deps))
    .use(clustersRoutes(deps))
    .use(accessRoutes(deps))
    .use(auditRoutes(deps))
    .use(gatewayLogRoutes(deps))
    .use(fleetRoutes(deps))
    .use(mobilityRoutes(deps))
    .use(jobsRoutes(deps))
    .use(replicationRoutes(deps))
    .use(backupsRoutes(deps))
    .use(balancingRoutes(deps))
    .use(tenantCloudRoutes(deps))
    .use(kubernetesRoutes(deps));
}
