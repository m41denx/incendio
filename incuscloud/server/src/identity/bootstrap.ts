import { createHmac } from "node:crypto";
import type { HydraAdminApi, OAuth2Client } from "./hydra-admin.ts";
import { AUDIENCE } from "./routes.ts";

export const CLI_CLIENT_ID = "incus-cli";
export const WEB_CLIENT_ID = "incuscloud-web";

/** Derived from IC_SECRET_KEY so every replica agrees without storing it. */
export const webClientSecret = (secretKey: Buffer) => createHmac("sha256", secretKey).update("hydra-client:incuscloud-web").digest("base64url");

const first = { metadata: { first_party: true }, audience: [AUDIENCE], access_token_strategy: "jwt", skip_consent: false };

/** The OAuth2 clients IncusCloud needs in Hydra, created or brought up to date. */
export async function ensureClients(hydra: HydraAdminApi, opts: { publicUrl: string; secretKey: Buffer }): Promise<void> {
  const wanted: OAuth2Client[] = [
    {
      ...first,
      client_id: CLI_CLIENT_ID,
      client_name: "Incus command line",
      // Public client: the incus CLI does the device flow without a secret.
      token_endpoint_auth_method: "none",
      grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid offline_access email profile",
    },
    {
      ...first,
      client_id: WEB_CLIENT_ID,
      client_name: "IncusCloud",
      client_secret: webClientSecret(opts.secretKey),
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: [`${opts.publicUrl}/auth/callback`],
      post_logout_redirect_uris: [`${opts.publicUrl}/`],
      scope: "openid offline_access email profile",
    },
  ];
  for (const c of wanted) {
    if (await hydra.getClient(c.client_id!)) await hydra.updateClient(c);
    else await hydra.createClient(c);
  }
}
