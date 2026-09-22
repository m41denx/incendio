import axios, { type AxiosInstance } from "axios";
import { Agent } from "node:https";
import { readFileSync } from "node:fs";
import { env } from "../env.ts";
import { PinnedAgent } from "./tls-pin.ts";

let client: AxiosInstance | undefined;

/**
 * Lazily-constructed axios client for the Incus HTTPS API. Supports optional
 * client-certificate (mTLS) auth, which is how Incus authenticates API clients.
 */
export function incusClient(): AxiosInstance {
  if (client) return client;

  const cert = env.INCUS_CLIENT_CERT ? readFileSync(env.INCUS_CLIENT_CERT) : undefined;
  const key = env.INCUS_CLIENT_KEY ? readFileSync(env.INCUS_CLIENT_KEY) : undefined;
  // Pin the Incus server cert by fingerprint (see PinnedAgent for why `ca`
  // cannot work with Incus's self-signed leaf under Bun). Without a pinned cert
  // fall back to the OS trust store, or skip verification if explicitly asked.
  const httpsAgent = env.INCUS_INSECURE_SKIP_VERIFY
    ? new Agent({ rejectUnauthorized: false, cert, key })
    : env.INCUS_SERVER_CERT
      ? new PinnedAgent({
          pinnedCertPem: readFileSync(env.INCUS_SERVER_CERT, "utf8"),
          cert,
          key,
        })
      : new Agent({ cert, key });

  client = axios.create({
    baseURL: env.INCUS_API_URL,
    httpsAgent,
    timeout: 30_000,
  });

  return client;
}

/**
 * Map raw client/axios errors to actionable messages. With INCUS_SERVER_CERT
 * set the agent pins that exact cert, so TLS failures mean either no pin is
 * configured (OS trust store rejects the self-signed cert) or the Incus server
 * presented a different cert than the one pinned at deploy time.
 */
export function describeIncusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("does not match the pinned")) {
    return (
      `${message}. The Incus server certificate changed since the appliance was ` +
      `deployed; update INCUS_SERVER_CERT (/etc/incendio/server.crt) in the appliance.`
    );
  }
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
      `The Incus API cert is self-signed: set INCUS_SERVER_CERT to it so the ` +
      `agent pins it, or INCUS_INSECURE_SKIP_VERIFY=true.`
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
