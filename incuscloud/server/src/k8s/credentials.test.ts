import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, k8sCredentials, tenants } from "../db/schema.ts";
import { fingerprintOf } from "../incus/certs.ts";
import { FakeKube } from "./fake-kube.ts";
import { FakeCluster } from "./fake-cluster.ts";
import { ensureCredentials, revokeCredentials } from "./credentials.ts";

let db: Db;
let kube: FakeKube;
let incus: FakeCluster;
let cluster: typeof clusters.$inferSelect;
let tenant: typeof tenants.$inferSelect;

beforeEach(async () => {
  db = await testDb();
  kube = new FakeKube();
  incus = new FakeCluster();
  // The fake keys certificates the way Incus does: by the SHA-256 of the DER it was sent.
  incus.fingerprintOf = (b64) => fingerprintOf(`-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`);
  [cluster] = await db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "SERVER PEM", clientCert: "", clientKeyEnc: "" }).returning() as [typeof clusters.$inferSelect];
  [tenant] = await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning() as [typeof tenants.$inferSelect];
});

const deps = () => ({ db, kube, client: incus.client });
const secretOf = () => kube.objects.get("v1|Secret|ic-acme|incus-lab");

test("issues a certificate restricted to the tenant's project and gives CAPN its identity secret", async () => {
  const r = await ensureCredentials(deps(), { tenant, cluster, project: "acme" });
  expect(r).toEqual({ secretName: "incus-lab" });
  const [[fp, trusted]] = [...incus.certificates.entries()] as [[string, { name: string; type: string; restricted: boolean; projects: string[]; certificate: string }]];
  expect(trusted).toMatchObject({ name: "incuscloud-k8s-acme", type: "client", restricted: true, projects: ["acme"] });
  expect(trusted.certificate).not.toContain("BEGIN");
  const data = (secretOf() as unknown as { stringData: Record<string, string> }).stringData;
  expect(data).toMatchObject({ server: "https://10.0.0.5:8443", "server-crt": "SERVER PEM", project: "acme" });
  expect(data["client-key"]).toContain("PRIVATE KEY");
  expect(fingerprintOf(data["client-crt"]!)).toBe(fp);
  const [row] = await db.select().from(k8sCredentials);
  expect(row).toMatchObject({ tenantId: tenant.id, clusterId: cluster.id, fingerprint: fp });
  expect(JSON.stringify(row)).not.toContain("PRIVATE KEY");
});

test("issued once: a second call reuses the certificate", async () => {
  await ensureCredentials(deps(), { tenant, cluster, project: "acme" });
  await ensureCredentials(deps(), { tenant, cluster, project: "acme" });
  expect(incus.certificates.size).toBe(1);
  expect(incus.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

test("re-issued when the secret is gone: the old certificate is removed from the trust store", async () => {
  await ensureCredentials(deps(), { tenant, cluster, project: "acme" });
  const [old] = [...incus.certificates.keys()];
  kube.objects.delete("v1|Secret|ic-acme|incus-lab");
  await ensureCredentials(deps(), { tenant, cluster, project: "acme" });
  expect(incus.certificates.has(old!)).toBe(false);
  expect(incus.certificates.size).toBe(1);
  expect(secretOf()).toBeDefined();
  expect(await db.select().from(k8sCredentials)).toHaveLength(1);
});

test("revoke removes the trust entry, the secret and the row, and tolerates what is already gone", async () => {
  await ensureCredentials(deps(), { tenant, cluster, project: "acme" });
  await revokeCredentials(deps(), { tenant, cluster });
  expect(incus.certificates.size).toBe(0);
  expect(secretOf()).toBeUndefined();
  expect(await db.select().from(k8sCredentials).where(eq(k8sCredentials.tenantId, tenant.id))).toHaveLength(0);
  await revokeCredentials(deps(), { tenant, cluster });
});
