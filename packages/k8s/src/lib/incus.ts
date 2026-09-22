import axios, { type AxiosInstance } from "axios";
import { Agent } from "node:https";
import { readFileSync } from "node:fs";
import { env } from "../env.ts";

let client: AxiosInstance | undefined;

/**
 * Lazily-constructed axios client for the Incus HTTPS API. Supports optional
 * client-certificate (mTLS) auth, which is how Incus authenticates API clients.
 */
export function incusClient(): AxiosInstance {
  if (client) return client;

  const httpsAgent = new Agent({
    rejectUnauthorized: !env.INCUS_INSECURE_SKIP_VERIFY,
    // Pin the Incus server certificate (self-signed) as a trust anchor. NOTE:
    // this is honored under Node, but Bun's TLS stack won't trust a self-signed
    // *leaf* passed as `ca`. In the operator VM we therefore install the Incus
    // server cert into the OS trust store (see lib/operator.ts cloud-init),
    // which both runtimes honor; this `ca` remains correct for Node hosts.
    ca: env.INCUS_SERVER_CERT ? readFileSync(env.INCUS_SERVER_CERT) : undefined,
    cert: env.INCUS_CLIENT_CERT ? readFileSync(env.INCUS_CLIENT_CERT) : undefined,
    key: env.INCUS_CLIENT_KEY ? readFileSync(env.INCUS_CLIENT_KEY) : undefined,
  });

  client = axios.create({
    baseURL: env.INCUS_API_URL,
    httpsAgent,
    timeout: 30_000,
  });

  return client;
}

/**
 * Map raw client/axios errors to actionable messages. The Incus API cert is
 * self-signed, and Bun's TLS won't trust a self-signed leaf via `ca`, so the
 * common failure when running the agent on a host is a TLS verification error.
 */
export function describeIncusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const tlsHints = [
    "unable to verify the first certificate",
    "self-signed certificate",
    "self signed certificate",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ];
  if (tlsHints.some((hint) => message.includes(hint))) {
    return (
      `TLS verification of the Incus server certificate failed (${message}). ` +
      `The Incus API cert is self-signed. When running the agent on a host, set ` +
      `INCUS_INSECURE_SKIP_VERIFY=true, or install the Incus server cert into the ` +
      `OS trust store. In the operator VM this is handled automatically.`
    );
  }
  return message;
}

/**
 * Best-effort extraction of the real Incus error. Axios buries the useful
 * message in `response.data` (Incus returns `{ error, error_code }`, or an
 * operation whose `metadata.err` holds the failure), so surface that first and
 * fall back to TLS/other guidance.
 */
export function incusErrorDetail(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (
      error as { response?: { status?: number; data?: unknown } }
    ).response;
    const data = response?.data;
    if (typeof data === "string" && data.length > 0) return data;
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.error === "string" && record.error.length > 0) {
        const code =
          typeof record.error_code === "number"
            ? ` (error_code ${record.error_code})`
            : "";
        return `${record.error}${code}`;
      }
      const metadata = record.metadata as Record<string, unknown> | undefined;
      if (typeof metadata?.err === "string" && metadata.err.length > 0) {
        return metadata.err;
      }
    }
  }
  return describeIncusError(error);
}
