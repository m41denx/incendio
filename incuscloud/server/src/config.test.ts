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
  expect(c.openfga.storeName).toBe("incuscloud-platform");
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
