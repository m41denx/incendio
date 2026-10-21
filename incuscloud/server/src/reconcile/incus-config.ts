import type { IncusAdminClient, IncusServer } from "../incus/admin-client.ts";

/** What every cluster's server config must say (spec D1, D3, D4). */
export function clusterConfigFor(o: { issuer: string; clientId: string; audience: string; openfgaUrl: string; openfgaToken?: string; storeId: string }): Record<string, string> {
  return {
    "oidc.issuer": o.issuer,
    "oidc.client.id": o.clientId,
    "oidc.audience": o.audience,
    "oidc.claim": "sub",
    "authorization.openfga.api.url": o.openfgaUrl,
    ...(o.openfgaToken ? { "authorization.openfga.api.token": o.openfgaToken } : {}),
    "authorization.openfga.store.id": o.storeId,
    // OIDC users through OpenFGA; unrestricted certificates (the control plane) stay admins.
    "authorization.client.oidc": "openfga",
    "authorization.client.tls": "allow",
  };
}

/** Sets the keys whose value differs (one PATCH); returns their names, never their values. */
export async function ensureServerConfig(client: IncusAdminClient, want: Record<string, string>): Promise<string[]> {
  const current = (await client.request<IncusServer>("GET", "/1.0")).metadata.config ?? {};
  const changed = Object.keys(want).filter((k) => current[k] !== want[k]);
  if (changed.length) await client.request("PATCH", "/1.0", { config: Object.fromEntries(changed.map((k) => [k, want[k]])) });
  return changed;
}

const MANAGED_KEYS = Object.keys(clusterConfigFor({ issuer: "", clientId: "", audience: "", openfgaUrl: "", openfgaToken: "x", storeId: "" }));

/** Undoes clusterConfigFor when a cluster leaves the platform: it stops trusting IncusCloud's tokens and grants. */
export async function releaseServerConfig(client: IncusAdminClient): Promise<void> {
  const current = (await client.request<IncusServer>("GET", "/1.0")).metadata.config ?? {};
  const set = MANAGED_KEYS.filter((k) => k in current);
  if (set.length) await client.request("PATCH", "/1.0", { config: Object.fromEntries(set.map((k) => [k, ""])) });
}
