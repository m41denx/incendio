import { app } from "./app.ts";
import { env } from "./env.ts";
import { log } from "./lib/log.ts";

// Serve self-signed TLS when both cert and key are configured (the bootstrap
// script generates them in the appliance; see docs/k8s/management-appliance.md
// §6). When either is missing we fall back to plain HTTP for local dev, so the
// transport stays swappable without code changes.
const tlsEnabled = Boolean(env.TLS_CERT_FILE && env.TLS_KEY_FILE);
const tls = tlsEnabled
  ? {
      cert: Bun.file(env.TLS_CERT_FILE as string),
      key: Bun.file(env.TLS_KEY_FILE as string),
    }
  : undefined;

app.listen({ port: env.PORT, hostname: env.HOST, tls });

const scheme = tlsEnabled ? "https" : "http";
log.info(
  `incendio-k8s agent listening on ${scheme}://${env.HOST}:${env.PORT} (OpenAPI at /openapi)` +
    (tlsEnabled ? "" : " [plain HTTP — dev only, no TLS_CERT_FILE/TLS_KEY_FILE]"),
);
