import { readFileSync } from "node:fs";
import {
  ClientWriteRequestOnDuplicateWrites,
  ClientWriteRequestOnMissingDeletes,
  CredentialsMethod,
  OpenFgaClient,
  type AuthorizationModel,
} from "@openfga/sdk";
import { transformer } from "@openfga/syntax-transformer";

export interface Tuple {
  user: string;
  relation: string;
  object: string;
}

export interface AuthzConfig {
  url: string;
  token?: string;
  storeName: string;
}

/** Platform-level authorization: who may do what to the platform, tenants and clusters. */
export interface Authz {
  check(user: string, relation: string, object: string): Promise<boolean>;
  write(writes: Tuple[], deletes?: Tuple[]): Promise<void>;
  listObjects(user: string, relation: string, type: string): Promise<string[]>;
}

export const PLATFORM = "platform:main";

const modelDsl = readFileSync(new URL("model.fga", import.meta.url), "utf8");
const model = transformer.transformDSLToJSONObject(modelDsl) as unknown as AuthorizationModel;

// Compared as DSL with sorted keys: the server fills defaults (`object: ""`,
// `condition: ""`) into stored JSON and returns relations sorted by name.
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v;
const toDsl = (m: AuthorizationModel) => transformer.transformJSONToDSL(sortKeys(m) as never);
const modelDslCanonical = toDsl(model);

/** The `platform` OpenFGA store (spec D4 / §3.1). */
export class PlatformAuthz implements Authz {
  private constructor(
    private readonly client: OpenFgaClient,
    readonly storeName: string,
    readonly storeId: string,
    readonly modelId: string,
  ) {}

  /** Finds or creates the store by name and writes the model if it changed. Idempotent. */
  static async init(cfg: AuthzConfig): Promise<PlatformAuthz> {
    const credentials = cfg.token ? { method: CredentialsMethod.ApiToken as const, config: { token: cfg.token } } : undefined;
    const base = new OpenFgaClient({ apiUrl: cfg.url, credentials });

    let storeId: string | undefined;
    let continuationToken: string | undefined;
    do {
      const page = await base.listStores({ pageSize: 100, continuationToken });
      storeId = page.stores.find((s) => s.name === cfg.storeName)?.id;
      continuationToken = page.continuation_token || undefined;
    } while (!storeId && continuationToken);
    storeId ??= (await base.createStore({ name: cfg.storeName })).id;

    const client = new OpenFgaClient({ apiUrl: cfg.url, credentials, storeId });
    let modelId: string | undefined;
    try {
      const latest = (await client.readLatestAuthorizationModel()).authorization_model;
      if (latest && toDsl(latest) === modelDslCanonical) modelId = latest.id;
    } catch {
      // No model yet.
    }
    modelId ??= (await client.writeAuthorizationModel(model)).authorization_model_id;
    client.authorizationModelId = modelId;
    return new PlatformAuthz(client, cfg.storeName, storeId, modelId);
  }

  async check(user: string, relation: string, object: string): Promise<boolean> {
    return !!(await this.client.check({ user, relation, object })).allowed;
  }

  /** Writes and deletes tuples; duplicates and missing deletes are not errors. */
  async write(writes: Tuple[], deletes: Tuple[] = []): Promise<void> {
    if (!writes.length && !deletes.length) return;
    await this.client.write(
      { writes: writes.length ? writes : undefined, deletes: deletes.length ? deletes : undefined },
      { conflict: { onDuplicateWrites: ClientWriteRequestOnDuplicateWrites.Ignore, onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore } },
    );
  }

  async listObjects(user: string, relation: string, type: string): Promise<string[]> {
    return (await this.client.listObjects({ user, relation, type })).objects.sort();
  }
}
