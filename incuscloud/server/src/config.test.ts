import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const base = {
  IC_PUBLIC_URL: "https://cloud.example",
  IC_DATABASE_URL: "postgres://ic@db/ic",
  IC_SECRET_KEY: Buffer.alloc(32, 1).toString("base64"),
  IC_HYDRA_PUBLIC_URL: "https://id.example",
  IC_HYDRA_ADMIN_URL: "http://hydra:4445",
  IC_OPENFGA_URL: "http://fga:8080",
  IC_CLUSTER_DOMAIN: "clusters.example",
  IC_TLS_CERT: "/tls/crt",
  IC_TLS_KEY: "/tls/key",
};

test("applies defaults", () => {
  const c = loadConfig(base);
  expect(c.listen).toEqual({ host: "0.0.0.0", port: 8443 });
  expect(c.secretKey.length).toBe(32);
  expect(c.bootstrapAdmin).toBeUndefined();
  expect(c.gatewaySampleReads).toBe(0);
});

test("gateway read sampling is a share between 0 and 1", () => {
  expect(loadConfig({ ...base, IC_GATEWAY_SAMPLE_READS: "0.25" }).gatewaySampleReads).toBe(0.25);
  expect(() => loadConfig({ ...base, IC_GATEWAY_SAMPLE_READS: "2" })).toThrow(/IC_GATEWAY_SAMPLE_READS/);
});

test("rejects a secret key shorter than 32 bytes", () => {
  expect(() => loadConfig({ ...base, IC_SECRET_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/IC_SECRET_KEY/);
});

test("reports every missing setting at once", () => {
  expect(() => loadConfig({})).toThrow(/IC_PUBLIC_URL[\s\S]*IC_DATABASE_URL/);
});

test("bootstrap admin needs both email and password", () => {
  expect(() => loadConfig({ ...base, IC_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com" })).toThrow(/IC_BOOTSTRAP_ADMIN_PASSWORD/);
  const c = loadConfig({ ...base, IC_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com", IC_BOOTSTRAP_ADMIN_PASSWORD: "correct horse battery" });
  expect(c.bootstrapAdmin).toEqual({ email: "admin@example.com", password: "correct horse battery" });
});

test("role, cluster OpenFGA and reconcile interval have defaults", () => {
  const c = loadConfig(base);
  expect(c.role).toBe("all");
  expect(c.openfga.clusterUrl).toBe("http://fga:8080");
  expect(c.openfga.clusterToken).toBeUndefined();
  expect(c.reconcileIntervalMs).toBe(60000);
});

test("reads role, cluster OpenFGA URL and reconcile interval overrides", () => {
  const c = loadConfig({ ...base, IC_ROLE: "worker", IC_OPENFGA_CLUSTER_URL: "https://fga.example/", IC_RECONCILE_INTERVAL: "300" });
  expect(c.role).toBe("worker");
  expect(c.openfga.clusterUrl).toBe("https://fga.example");
  expect(c.reconcileIntervalMs).toBe(300000);
});

test("cluster token falls back to the API token", () => {
  expect(loadConfig({ ...base, IC_OPENFGA_TOKEN: "k" }).openfga.clusterToken).toBe("k");
  expect(loadConfig({ ...base, IC_OPENFGA_TOKEN: "k", IC_OPENFGA_CLUSTER_TOKEN: "ck" }).openfga.clusterToken).toBe("ck");
});

test("rejects an unknown role, a too-short reconcile interval and an invalid cluster OpenFGA URL", () => {
  expect(() => loadConfig({ ...base, IC_ROLE: "both" })).toThrow(/IC_ROLE/);
  expect(() => loadConfig({ ...base, IC_RECONCILE_INTERVAL: "5" })).toThrow(/IC_RECONCILE_INTERVAL/);
  expect(() => loadConfig({ ...base, IC_OPENFGA_CLUSTER_URL: "not a url" })).toThrow(/IC_OPENFGA_CLUSTER_URL/);
});

test("inventory runs every minute by default, 0 turns it off; metrics are kept a day", () => {
  expect(loadConfig(base)).toMatchObject({ inventoryIntervalMs: 60_000, metricsRetentionMs: 24 * 3_600_000 });
  expect(loadConfig({ ...base, IC_INVENTORY_INTERVAL: "0", IC_METRICS_RETENTION: "168" })).toMatchObject({ inventoryIntervalMs: 0, metricsRetentionMs: 168 * 3_600_000 });
  expect(() => loadConfig({ ...base, IC_INVENTORY_INTERVAL: "5" })).toThrow(/IC_INVENTORY_INTERVAL/);
  expect(() => loadConfig({ ...base, IC_METRICS_RETENTION: "0" })).toThrow(/IC_METRICS_RETENTION/);
});

test("jobs run two at a time by default", () => {
  expect(loadConfig(base).jobConcurrency).toBe(2);
  expect(loadConfig({ ...base, IC_JOB_CONCURRENCY: "8" }).jobConcurrency).toBe(8);
  expect(loadConfig(base).imageServer).toBe("https://images.linuxcontainers.org");
  expect(loadConfig({ ...base, IC_IMAGE_SERVER: "https://mirror.example/" }).imageServer).toBe("https://mirror.example");
  expect(() => loadConfig({ ...base, IC_JOB_CONCURRENCY: "0" })).toThrow(/IC_JOB_CONCURRENCY/);
});

test("the console's image catalogue: the image server and any extra simplestreams servers", () => {
  expect(loadConfig(base).imageServers).toEqual(["https://images.linuxcontainers.org"]);
  expect(loadConfig({ ...base, IC_IMAGE_SERVER: "https://mirror.example/", IC_IMAGE_SERVERS: "https://a.example/, https://mirror.example,https://b.example" }).imageServers).toEqual([
    "https://mirror.example",
    "https://a.example",
    "https://b.example",
  ]);
  expect(() => loadConfig({ ...base, IC_IMAGE_SERVERS: "not a url" })).toThrow(/IC_IMAGE_SERVERS/);
});

test("Kubernetes is off without a management kubeconfig; ports default to 16443-16999", () => {
  expect(loadConfig(base).k8s).toBeUndefined();
  expect(loadConfig({ ...base, IC_K8S_KUBECONFIG: "/etc/ic/mgmt.kubeconfig" }).k8s).toEqual({
    kubeconfig: "/etc/ic/mgmt.kubeconfig",
    ports: [16443, 16999],
    // MetalLB as Incendio's agent installs it.
    metallbManifestUrl: "https://raw.githubusercontent.com/metallb/metallb/v0.16.0/config/manifests/metallb-native.yaml",
  });
  expect(loadConfig({ ...base, IC_K8S_KUBECONFIG: "/k", IC_K8S_PORTS: "20000-20010" }).k8s?.ports).toEqual([20000, 20010]);
  for (const bad of ["20010-20000", "80-90", "1-2-3", "x", "20000-70000"]) expect(() => loadConfig({ ...base, IC_K8S_KUBECONFIG: "/k", IC_K8S_PORTS: bad })).toThrow(/IC_K8S_PORTS/);
});
