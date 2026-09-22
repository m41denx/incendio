import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Validated runtime configuration for the agent. Import-time validation means a
 * misconfigured agent fails fast on boot instead of at first request.
 */
export const env = createEnv({
  server: {
    HOST: z.string().default("0.0.0.0"),
    // Default 8843 to avoid colliding with the Incus HTTPS API (8443) when the
    // agent runs on the same host during dev.
    PORT: z.coerce.number().int().positive().max(65535).default(8843),
    // Bearer token the Incendio UI must present on every privileged request.
    AGENT_TOKEN: z.string().min(16, "AGENT_TOKEN must be at least 16 characters"),
    // Secret used to sign short-lived JWTs handed back to the UI.
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    // Comma-separated list of allowed browser origins, or "*" for any.
    CORS_ORIGIN: z.string().default("*"),
    // Incus HTTPS API endpoint the agent talks to on behalf of the UI.
    INCUS_API_URL: z.string().default("https://127.0.0.1:8443"),
    INCUS_CLIENT_CERT: z.string().optional(),
    INCUS_CLIENT_KEY: z.string().optional(),
    // Incus server certificate PEM path used to pin/verify TLS (the same
    // material as `server-crt` in the CAPN lxc-secret). Preferred over
    // INCUS_INSECURE_SKIP_VERIFY.
    INCUS_SERVER_CERT: z.string().optional(),
    INCUS_INSECURE_SKIP_VERIFY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
