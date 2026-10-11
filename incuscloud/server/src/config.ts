import { z } from "zod";

/** Validated server configuration, read from IC_* environment variables. */
export interface Config {
  listen: { host: string; port: number };
  publicUrl: string;
  tls: { certFile: string; keyFile: string };
  databaseUrl: string;
  secretKey: Buffer;
  hydra: { publicUrl: string; adminUrl: string; caFile?: string };
  openfga: { url: string; token?: string; storeName: string };
  clusterDomain: string;
  bootstrapAdmin?: { email: string; password: string };
  logLevel: "debug" | "info" | "warn" | "error";
}

const url = z.url();
const schema = z
  .object({
    IC_LISTEN_HOST: z.string().default("0.0.0.0"),
    IC_LISTEN_PORT: z.coerce.number().int().min(1).max(65535).default(8443),
    IC_PUBLIC_URL: url,
    IC_TLS_CERT: z.string().min(1),
    IC_TLS_KEY: z.string().min(1),
    IC_DATABASE_URL: z.string().min(1),
    IC_SECRET_KEY: z
      .string()
      .transform((s) => Buffer.from(s, "base64"))
      .refine((b) => b.length >= 32, "must be at least 32 bytes, base64-encoded"),
    IC_HYDRA_PUBLIC_URL: url,
    IC_HYDRA_ADMIN_URL: url,
    IC_HYDRA_CA_FILE: z.string().optional(),
    IC_OPENFGA_URL: url,
    IC_OPENFGA_TOKEN: z.string().optional(),
    IC_OPENFGA_STORE: z.string().default("incuscloud-platform"),
    IC_CLUSTER_DOMAIN: z.string().min(1),
    IC_BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
    IC_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
    IC_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((v, ctx) => {
    if (!!v.IC_BOOTSTRAP_ADMIN_EMAIL !== !!v.IC_BOOTSTRAP_ADMIN_PASSWORD) {
      const missing = v.IC_BOOTSTRAP_ADMIN_EMAIL ? "IC_BOOTSTRAP_ADMIN_PASSWORD" : "IC_BOOTSTRAP_ADMIN_EMAIL";
      ctx.addIssue({ code: "custom", path: [missing], message: "set both bootstrap admin email and password, or neither" });
    }
  });

/** Parses the environment; throws one error listing every invalid setting. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const v = r.data;
  return {
    listen: { host: v.IC_LISTEN_HOST, port: v.IC_LISTEN_PORT },
    publicUrl: v.IC_PUBLIC_URL.replace(/\/$/, ""),
    tls: { certFile: v.IC_TLS_CERT, keyFile: v.IC_TLS_KEY },
    databaseUrl: v.IC_DATABASE_URL,
    secretKey: v.IC_SECRET_KEY,
    hydra: { publicUrl: v.IC_HYDRA_PUBLIC_URL.replace(/\/$/, ""), adminUrl: v.IC_HYDRA_ADMIN_URL.replace(/\/$/, ""), caFile: v.IC_HYDRA_CA_FILE },
    openfga: { url: v.IC_OPENFGA_URL.replace(/\/$/, ""), token: v.IC_OPENFGA_TOKEN, storeName: v.IC_OPENFGA_STORE },
    clusterDomain: v.IC_CLUSTER_DOMAIN,
    bootstrapAdmin: v.IC_BOOTSTRAP_ADMIN_EMAIL ? { email: v.IC_BOOTSTRAP_ADMIN_EMAIL, password: v.IC_BOOTSTRAP_ADMIN_PASSWORD! } : undefined,
    logLevel: v.IC_LOG_LEVEL,
  };
}
