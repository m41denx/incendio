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
