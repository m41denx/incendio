import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { k8sClusters, k8sCredentials, type clusters, type tenants } from "../db/schema.ts";
import { ClusterError, type IncusAdminClient } from "../incus/admin-client.ts";
import { fingerprintOf, generateClientCertificate } from "../incus/certs.ts";
import type { Kube } from "./kube.ts";
import { identitySecret } from "./manifests.ts";
import { namespaceOf } from "./model.ts";

export interface CredentialDeps {
  db: Db;
  kube: Kube;
  /** The Incus cluster's admin client. */
  client: IncusAdminClient;
}

type Tenant = Pick<typeof tenants.$inferSelect, "id" | "slug">;
type Cluster = Pick<typeof clusters.$inferSelect, "id" | "name" | "url" | "serverCert">;

export const secretNameOf = (cluster: { name: string }) => `incus-${cluster.name}`;

/** The base64 DER Incus takes for a certificate (the PEM body). */
const derOf = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

const untrust = async (client: IncusAdminClient, fingerprint: string) => {
  try {
    await client.request("DELETE", `/1.0/certificates/${fingerprint}`);
  } catch (e) {
    if (!(e instanceof ClusterError && e.clusterStatus === 404)) throw e;
  }
};

/**
 * Runs `fn` holding the lock on one tenant's credentials on one Incus cluster:
 * two creates must not both issue a certificate (the second secret would
 * replace the first's key), and a delete's last-one check must not race a create.
 */
function locked<T>(db: Db, tenantId: string, clusterId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    await txDb.execute(sql`select pg_advisory_xact_lock(hashtext(${`k8s-credentials:${tenantId}:${clusterId}`}))`);
    return fn(txDb);
  });
}

/**
 * CAPN's way into one Incus cluster for one tenant: a client certificate
 * trusted only for the tenant's project, and the identity secret holding it
 * in the tenant's namespace. Issued once; the key exists only in the secret,
 * so a missing secret means a new certificate (the old one is untrusted).
 */
export function ensureCredentials(deps: CredentialDeps, o: { tenant: Tenant; cluster: Cluster; project: string }): Promise<{ secretName: string }> {
  return locked(deps.db, o.tenant.id, o.cluster.id, (db) => issue({ ...deps, db }, o));
}

async function issue(deps: CredentialDeps, o: { tenant: Tenant; cluster: Cluster; project: string }): Promise<{ secretName: string }> {
  const { db, kube, client } = deps;
  const namespace = namespaceOf(o.tenant.slug);
  const secretName = secretNameOf(o.cluster);
  const where = and(eq(k8sCredentials.tenantId, o.tenant.id), eq(k8sCredentials.clusterId, o.cluster.id));
  const [row] = await db.select().from(k8sCredentials).where(where);
  if (row && (await kube.get("v1", "Secret", namespace, secretName))) return { secretName };
  if (row) {
    await untrust(client, row.fingerprint);
    await db.delete(k8sCredentials).where(where);
  }

  const name = `incuscloud-k8s-${o.tenant.slug}`;
  const { cert, key } = await generateClientCertificate(name);
  await client.request("POST", "/1.0/certificates", { type: "client", name, certificate: derOf(cert), restricted: true, projects: [o.project] });
  const fingerprint = fingerprintOf(cert);
  try {
    await kube.apply(identitySecret({ namespace, name: secretName, server: o.cluster.url, serverCert: o.cluster.serverCert, cert, key, project: o.project }));
  } catch (e) {
    // Without the secret the key is lost: do not leave a trusted certificate nobody holds.
    await untrust(client, fingerprint);
    throw e;
  }
  await db.insert(k8sCredentials).values({ tenantId: o.tenant.id, clusterId: o.cluster.id, fingerprint });
  return { secretName };
}

/** Revokes the credentials unless a Kubernetes cluster other than `except` still uses them; true when revoked. */
export function revokeUnlessUsed(deps: CredentialDeps, o: { tenant: Tenant; cluster: Pick<Cluster, "id" | "name">; except: string }): Promise<boolean> {
  return locked(deps.db, o.tenant.id, o.cluster.id, async (db) => {
    const others = await db
      .select({ id: k8sClusters.id })
      .from(k8sClusters)
      .where(and(eq(k8sClusters.tenantId, o.tenant.id), eq(k8sClusters.clusterId, o.cluster.id), ne(k8sClusters.id, o.except)));
    if (others.length) return false;
    await revokeCredentials({ ...deps, db }, o);
    return true;
  });
}

/** Untrusts the certificate and removes the secret and the record; what is already gone is fine. */
export async function revokeCredentials(deps: CredentialDeps, o: { tenant: Tenant; cluster: Pick<Cluster, "id" | "name"> }): Promise<void> {
  const { db, kube, client } = deps;
  const where = and(eq(k8sCredentials.tenantId, o.tenant.id), eq(k8sCredentials.clusterId, o.cluster.id));
  const [row] = await db.select().from(k8sCredentials).where(where);
  if (row) await untrust(client, row.fingerprint);
  await kube.delete("v1", "Secret", namespaceOf(o.tenant.slug), secretNameOf(o.cluster));
  await db.delete(k8sCredentials).where(where);
}
