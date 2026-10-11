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
