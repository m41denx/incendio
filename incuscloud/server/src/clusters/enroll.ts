import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { open, seal } from "../lib/secrets.ts";
import { IncusAdminClient } from "../incus/admin-client.ts";
import { fingerprintOf, generateClientCertificate } from "../incus/certs.ts";
import { decodeTrustToken } from "../incus/trust-token.ts";

export type ClusterRow = typeof clusters.$inferSelect;

/** The admin client for an enrolled cluster. */
export function clusterClient(deps: { secretKey: Buffer }, row: Pick<ClusterRow, "url" | "fingerprint" | "clientCert" | "clientKeyEnc">) {
  return new IncusAdminClient({ url: row.url, fingerprint: row.fingerprint, cert: row.clientCert, key: open(deps.secretKey, row.clientKeyEnc) });
}

const urlOf = (address: string) => `https://${address}`;

/**
 * Enrols a cluster from an Incus trust token: generates this cluster's client
 * certificate, connects to the first reachable address with the token's
 * fingerprint pinned, redeems the token, checks we are trusted, and stores it.
 */
export async function enrollCluster(
  deps: { db: Db; secretKey: Buffer },
  input: { name: string; token: string; labels?: Record<string, string> },
): Promise<ClusterRow> {
  const token = decodeTrustToken(input.token);
  if ((await deps.db.select({ id: clusters.id }).from(clusters).where(eq(clusters.name, input.name))).length) {
    throw new ApiError(409, "cluster_exists", `A cluster named "${input.name}" already exists`);
  }
  const identity = await generateClientCertificate(`incuscloud-${input.name}`);

  // Tokens list every address the cluster listens on, often including ones
  // this side cannot route to: probe them all at once, use the first that
  // answers with the pinned certificate.
  const probes = token.addresses.map(async (address) => {
    const client = new IncusAdminClient({ url: urlOf(address), fingerprint: token.fingerprint, ...identity, timeoutMs: 8_000 });
    await client.server();
    return { address, client };
  });
  let winner: { address: string; client: IncusAdminClient };
  try {
    winner = await Promise.any(probes);
  } catch (e) {
    const errors = (e as AggregateError).errors.map((x: Error) => x.message);
    if (errors.some((m) => /does not match the pinned/.test(m))) {
      throw new ApiError(400, "fingerprint_mismatch", "The cluster presented a certificate that does not match the token");
    }
    throw new ApiError(502, "cluster_unreachable", `Could not reach any address in the token (${token.addresses.map((a, i) => `${a}: ${errors[i]}`).join("; ")})`);
  }
  const { address, client } = winner;

  try {
    await client.request("POST", "/1.0/certificates", { type: "client", trust_token: input.token.trim(), name: "incuscloud" });
  } catch (e) {
    if (e instanceof ApiError && e.code === "cluster_error") {
      throw new ApiError(400, "token_refused", `The cluster refused the trust token: ${e.message.replace(/^Cluster: /, "")}`);
    }
    throw e;
  }
  const server = await client.server();
  if (server.auth !== "trusted") {
    throw new ApiError(502, "not_trusted", "The cluster accepted the token but does not trust the control plane");
  }
  const serverCert = server.environment.certificate;
  if (fingerprintOf(serverCert) !== token.fingerprint) {
    throw new ApiError(502, "fingerprint_mismatch", "The cluster reports a different certificate than it presented");
  }
  const [row] = await deps.db
    .insert(clusters)
    .values({
      name: input.name,
      url: urlOf(address),
      addresses: token.addresses,
      fingerprint: token.fingerprint,
      serverCert,
      clientCert: identity.cert,
      clientKeyEnc: seal(deps.secretKey, identity.key),
      status: "ready",
      labels: input.labels ?? {},
      lastSeenAt: new Date(),
    })
    .returning();
  return row!;
}
