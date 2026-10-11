import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";
import { createFront } from "./front.ts";
import { openDb } from "./db/index.ts";
import { PlatformAuthz } from "./authz/platform.ts";
import { syncAll } from "./authz/sync.ts";
import { HydraAdmin } from "./identity/hydra-admin.ts";
import { CLI_CLIENT_ID, ensureClients, webClientSecret } from "./identity/bootstrap.ts";
import { AUDIENCE } from "./identity/routes.ts";
import { HydraTokens } from "./auth/session.ts";
import { createVerifier, discoverIssuer, remoteJwks } from "./auth/verify.ts";
import { ensureBootstrapAdmin } from "./bootstrap/admin.ts";
import { log, setLogLevel } from "./lib/log.ts";
import { createGateway } from "./gateway/handler.ts";
import { ClusterCache } from "./gateway/clusters-cache.ts";
import { Upstreams } from "./gateway/relay.ts";
import { RequestLog } from "./gateway/request-log.ts";
import { serveUi } from "./gateway/ui.ts";
import { Worker } from "./reconcile/worker.ts";
import { FleetWorker } from "./fleet/worker.ts";
import { JobRunner } from "./jobs/runner.ts";
import { jobHandlers } from "./jobs/handlers.ts";
import { scheduleReplication } from "./mobility/replication.ts";
import { scheduleBackups } from "./backups/backup-job.ts";
import { openClusterStore } from "./reconcile/cluster-store.ts";

/** Retries start-up steps whose dependency may still be starting (Hydra, OpenFGA). */
async function retry<T>(what: string, fn: () => Promise<T>, attempts = 30): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      log.warn(`${what} not ready, retrying`, { attempt: i, error: (e as Error).message });
      await Bun.sleep(Math.min(1000 * i, 5000));
    }
  }
}

const config = loadConfig(process.env);
setLogLevel(config.logLevel);

const hydraCa = config.hydra.caFile ? readFileSync(config.hydra.caFile, "utf8") : undefined;
const db = await openDb(config.databaseUrl);
const hydra = new HydraAdmin(config.hydra.adminUrl, { ca: hydraCa });
await retry("Hydra", () => ensureClients(hydra, { publicUrl: config.publicUrl, secretKey: config.secretKey }));
const issuer = await retry("Hydra discovery", () => discoverIssuer(config.hydra.publicUrl, hydraCa));
const authz = await retry("OpenFGA", () => PlatformAuthz.init(config.openfga));
log.info("authorization store ready", { store: authz.storeId, model: authz.modelId, tuples: await syncAll(db, authz) });
await ensureBootstrapAdmin(db, authz, config.bootstrapAdmin);

const serveApi = config.role !== "worker";
const worker =
  config.role !== "api"
    ? new Worker(
        {
          db,
          secretKey: config.secretKey,
          openStore: openClusterStore,
          oidc: { issuer, clientId: CLI_CLIENT_ID, audience: AUDIENCE },
          openfga: { url: config.openfga.url, token: config.openfga.token, clusterUrl: config.openfga.clusterUrl, clusterToken: config.openfga.clusterToken },
        },
        { holder: `${hostname()}/${process.pid}`, intervalMs: config.reconcileIntervalMs },
      )
    : undefined;
worker?.start();
if (worker) log.info("reconciler started", { intervalMs: config.reconcileIntervalMs });
const fleet =
  config.role !== "api" && config.inventoryIntervalMs > 0
    ? new FleetWorker({ db, secretKey: config.secretKey }, { holder: `${hostname()}/${process.pid}`, intervalMs: config.inventoryIntervalMs, retentionMs: config.metricsRetentionMs })
    : undefined;
fleet?.start();
// Schedulers queue due replication runs and backups before each pass.
const scheduleDue = async () => {
  await scheduleReplication(db);
  await scheduleBackups(db);
};
const jobRunner = config.role !== "api" ? new JobRunner({ db, secretKey: config.secretKey }, { holder: `${hostname()}/${process.pid}`, handlers: jobHandlers(), concurrency: config.jobConcurrency, beforeTick: scheduleDue }) : undefined;
jobRunner?.start();
if (fleet) log.info("inventory started", { intervalMs: config.inventoryIntervalMs });

const appDeps = {
  db,
  authz,
  hydra,
  tokens: new HydraTokens({ hydraPublicUrl: config.hydra.publicUrl, clientSecret: webClientSecret(config.secretKey), ca: hydraCa }),
  verify: createVerifier({ issuer, audience: AUDIENCE, jwks: remoteJwks(config.hydra.publicUrl, hydraCa) }),
  secretKey: config.secretKey,
  publicUrl: config.publicUrl,
  hydraPublicUrl: config.hydra.publicUrl,
  secureCookies: config.publicUrl.startsWith("https://"),
  clusterDomain: config.clusterDomain,
};
const app = createApp(appDeps);
const requestLog = new RequestLog(db, { sampleReads: config.gatewaySampleReads });
const gateway = createGateway({
  ...appDeps,
  clusterDomain: config.clusterDomain,
  clusters: new ClusterCache(db),
  upstreams: new Upstreams(),
  onRequest: (r) => requestLog.record(r),
  oidc: { issuer, clientId: CLI_CLIENT_ID, audience: AUDIENCE, scopes: "openid,offline_access,email,profile" },
  ui: config.uiDir ? (req, res, route, _cluster, principal) => serveUi(req, res, route, { uiDir: config.uiDir!, signedIn: !!principal }) : undefined,
});
const server = createFront({
  app,
  gateway,
  tls: { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) },
  web: config.webDir ? { dir: config.webDir } : undefined,
});
if (serveApi) server.listen(config.listen.port, config.listen.host, () => log.info("listening", { ...config.listen, publicUrl: config.publicUrl }));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("shutting down", { signal: sig });
    const closeServer = serveApi ? new Promise<void>((resolve) => server.close(() => resolve())) : Promise.resolve();
    // The worker releases its lease so another replica takes over at once.
    Promise.all([closeServer.then(() => requestLog.stop()), worker?.stop(), fleet?.stop(), jobRunner?.stop()]).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
