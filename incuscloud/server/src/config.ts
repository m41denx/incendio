import { z } from "zod";

/** Validated server configuration, read from IC_* environment variables. */
export interface Config {
  /** Which parts this process runs: the HTTP API/gateway, the reconciler worker, or both. */
  role: "api" | "worker" | "all";
  listen: { host: string; port: number };
  publicUrl: string;
  tls: { certFile: string; keyFile: string };
  databaseUrl: string;
  secretKey: Buffer;
  hydra: { publicUrl: string; adminUrl: string; caFile?: string };
  /** OpenFGA; clusterUrl and clusterToken are as the Incus clusters reach it (they connect to it themselves). */
  openfga: { url: string; token?: string; storeName: string; clusterUrl: string; clusterToken?: string };
  /** Every cluster is reconciled at least this often. */
  reconcileIntervalMs: number;
  /** Each cluster's inventory is read this often (P5); 0 turns inventory off. */
  inventoryIntervalMs: number;
  /** Metrics samples are kept this long. */
  metricsRetentionMs: number;
  /** Jobs (migrations, replication runs) the worker runs at once. */
  jobConcurrency: number;
  /** Simplestreams server self-service creates take images from. */
  imageServer: string;
  /** Simplestreams servers the console's image picker lists (the image server first). */
  imageServers: string[];
  /** The management cluster CAPI and CAPN run in (P10); absent turns Kubernetes off. */
  k8s?: { kubeconfig: string; ports: [number, number] };
  clusterDomain: string;
  bootstrapAdmin?: { email: string; password: string };
  logLevel: "debug" | "info" | "warn" | "error";
  /** Share of gateway reads (GET/HEAD) to log, 0..1; changes are always logged. */
  gatewaySampleReads: number;
  /** Incendio's build (`packages/ui/build/ui`), served per cluster at /clusters/<name>/ui/. */
  uiDir?: string;
  /** The platform UI's build (`incuscloud/web/build`), served at /. */
  webDir?: string;
}

const url = z.url();
const schema = z
  .object({
    IC_ROLE: z.enum(["api", "worker", "all"]).default("all"),
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
    IC_OPENFGA_CLUSTER_URL: url.optional(),
    IC_OPENFGA_CLUSTER_TOKEN: z.string().optional(),
    IC_OPENFGA_STORE: z.string().default("incuscloud-platform"),
    IC_RECONCILE_INTERVAL: z.coerce.number().int().min(10).max(86400).default(60),
    IC_INVENTORY_INTERVAL: z.coerce
      .number()
      .int()
      .max(86400)
      .default(60)
      .refine((n) => n === 0 || n >= 10, "0 (off) or at least 10 seconds"),
    IC_METRICS_RETENTION: z.coerce.number().int().min(1).max(720).default(24),
    IC_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    IC_IMAGE_SERVER: url.default("https://images.linuxcontainers.org"),
    IC_IMAGE_SERVERS: z
      .string()
      .default("")
      .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(url)),
    IC_K8S_KUBECONFIG: z.string().min(1).optional(),
    IC_K8S_PORTS: z
      .string()
      .default("16443-16999")
      .transform((s, ctx): [number, number] => {
        const m = /^(\d+)-(\d+)$/.exec(s);
        const [a, b] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
        if (!m || a < 1024 || b > 65535 || a > b) ctx.addIssue({ code: "custom", message: "a port range a-b with 1024 <= a <= b <= 65535" });
        return [a, b];
      }),
    IC_CLUSTER_DOMAIN: z.string().min(1),
    IC_BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
    IC_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
    IC_UI_DIR: z.string().min(1).optional(),
    IC_WEB_DIR: z.string().min(1).optional(),
    IC_GATEWAY_SAMPLE_READS: z.coerce.number().min(0).max(1).default(0),
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
  const openfgaUrl = v.IC_OPENFGA_URL.replace(/\/$/, "");
  return {
    role: v.IC_ROLE,
    listen: { host: v.IC_LISTEN_HOST, port: v.IC_LISTEN_PORT },
    publicUrl: v.IC_PUBLIC_URL.replace(/\/$/, ""),
    tls: { certFile: v.IC_TLS_CERT, keyFile: v.IC_TLS_KEY },
    databaseUrl: v.IC_DATABASE_URL,
    secretKey: v.IC_SECRET_KEY,
    hydra: { publicUrl: v.IC_HYDRA_PUBLIC_URL.replace(/\/$/, ""), adminUrl: v.IC_HYDRA_ADMIN_URL.replace(/\/$/, ""), caFile: v.IC_HYDRA_CA_FILE },
    openfga: {
      url: openfgaUrl,
      token: v.IC_OPENFGA_TOKEN,
      storeName: v.IC_OPENFGA_STORE,
      clusterUrl: v.IC_OPENFGA_CLUSTER_URL?.replace(/\/$/, "") ?? openfgaUrl,
      clusterToken: v.IC_OPENFGA_CLUSTER_TOKEN ?? v.IC_OPENFGA_TOKEN,
    },
    reconcileIntervalMs: v.IC_RECONCILE_INTERVAL * 1000,
    inventoryIntervalMs: v.IC_INVENTORY_INTERVAL * 1000,
    metricsRetentionMs: v.IC_METRICS_RETENTION * 3_600_000,
    jobConcurrency: v.IC_JOB_CONCURRENCY,
    imageServer: v.IC_IMAGE_SERVER.replace(/\/$/, ""),
    imageServers: [...new Set([v.IC_IMAGE_SERVER, ...v.IC_IMAGE_SERVERS].map((u) => u.replace(/\/$/, "")))],
    k8s: v.IC_K8S_KUBECONFIG ? { kubeconfig: v.IC_K8S_KUBECONFIG, ports: v.IC_K8S_PORTS } : undefined,
    clusterDomain: v.IC_CLUSTER_DOMAIN,
    bootstrapAdmin: v.IC_BOOTSTRAP_ADMIN_EMAIL ? { email: v.IC_BOOTSTRAP_ADMIN_EMAIL, password: v.IC_BOOTSTRAP_ADMIN_PASSWORD! } : undefined,
    logLevel: v.IC_LOG_LEVEL,
    gatewaySampleReads: v.IC_GATEWAY_SAMPLE_READS,
    uiDir: v.IC_UI_DIR,
    webDir: v.IC_WEB_DIR,
  };
}
