import { readFileSync } from "node:fs";
import { CredentialsMethod, OpenFgaClient } from "@openfga/sdk";
import { transformer } from "@openfga/syntax-transformer";

/** Uploads Incus's model into a store, as Incus does on first connect (tests only). */
export async function installIncusModel(url: string, token: string, storeId: string) {
  const dsl = readFileSync(new URL("fixtures/incus-openfga-model.fga", import.meta.url), "utf8");
  const client = new OpenFgaClient({ apiUrl: url, storeId, credentials: { method: CredentialsMethod.ApiToken, config: { token } } });
  await client.writeAuthorizationModel(transformer.transformDSLToJSONObject(dsl) as never);
}
