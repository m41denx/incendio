import { readFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";
import { createFront } from "./front.ts";
import { openDb } from "./db/index.ts";
import { PlatformAuthz } from "./authz/platform.ts";
import { syncAll } from "./authz/sync.ts";
import { HydraAdmin } from "./identity/hydra-admin.ts";
import { ensureClients, webClientSecret } from "./identity/bootstrap.ts";
import { AUDIENCE } from "./identity/routes.ts";
import { HydraTokens } from "./auth/session.ts";
import { createVerifier, remoteJwks } from "./auth/verify.ts";
import { ensureBootstrapAdmin } from "./bootstrap/admin.ts";
import { log, setLogLevel } from "./lib/log.ts";
import { createGateway } from "./gateway/handler.ts";
import { ClusterCache } from "./gateway/clusters-cache.ts";
import { Upstreams } from "./gateway/relay.ts";
import { RequestLog } from "./gateway/request-log.ts";

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
const authz = await retry("OpenFGA", () => PlatformAuthz.init(config.openfga));
log.info("authorization store ready", { store: authz.storeId, model: authz.modelId, tuples: await syncAll(db, authz) });
await ensureBootstrapAdmin(db, authz, config.bootstrapAdmin);

const appDeps = {
  db,
  authz,
  hydra,
  tokens: new HydraTokens({ hydraPublicUrl: config.hydra.publicUrl, clientSecret: webClientSecret(config.secretKey), ca: hydraCa }),
  verify: createVerifier({ issuer: config.hydra.publicUrl, audience: AUDIENCE, jwks: remoteJwks(config.hydra.publicUrl, hydraCa) }),
  secretKey: config.secretKey,
  publicUrl: config.publicUrl,
  hydraPublicUrl: config.hydra.publicUrl,
  secureCookies: config.publicUrl.startsWith("https://"),
};
const app = createApp(appDeps);
const requestLog = new RequestLog(db, { sampleReads: config.gatewaySampleReads });
const gateway = createGateway({ ...appDeps, clusterDomain: config.clusterDomain, clusters: new ClusterCache(db), upstreams: new Upstreams(), onRequest: (r) => requestLog.record(r) });
const server = createFront({
  app,
  gateway,
  tls: { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) },
});
server.listen(config.listen.port, config.listen.host, () => log.info("listening", { ...config.listen, publicUrl: config.publicUrl }));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("shutting down", { signal: sig });
    server.close(() => requestLog.stop().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
