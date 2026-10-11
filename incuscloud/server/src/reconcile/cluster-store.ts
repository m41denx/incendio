import { ClientWriteRequestOnDuplicateWrites, ClientWriteRequestOnMissingDeletes, CredentialsMethod, OpenFgaClient } from "@openfga/sdk";
import type { Tuple } from "../authz/platform.ts";
import { isManaged } from "./grants.ts";

/** One cluster's OpenFGA store (spec D4): Incus owns the model and resource tuples; IncusCloud its grants. */
export interface ClusterStore {
  readonly storeId: string;
  /** Whether Incus has uploaded its model yet (it does on first connect). */
  hasModel(): Promise<boolean>;
  /** Every IncusCloud tuple in the store. A full scan: OpenFGA cannot filter by type alone, so use it sparingly. */
  readManaged(): Promise<Tuple[]>;
  write(writes: Tuple[], deletes: Tuple[]): Promise<void>;
}

export interface ClusterStoreConfig {
  url: string;
  token?: string;
  /** The store recorded for this cluster, if any. */
  storeId?: string | null;
  /** Store name, used to find or create the store. */
  name: string;
}

const credentialsOf = (token?: string) => (token ? { method: CredentialsMethod.ApiToken as const, config: { token } } : undefined);


/** Opens the recorded store, or finds one by name, or creates it. */
export async function openClusterStore(cfg: ClusterStoreConfig): Promise<ClusterStore> {
  const credentials = credentialsOf(cfg.token);
  const base = new OpenFgaClient({ apiUrl: cfg.url, credentials });
  let storeId: string | undefined;
  if (cfg.storeId) {
    try {
      storeId = (await base.getStore({ storeId: cfg.storeId })).id;
    } catch {
      // Gone (OpenFGA restarted empty, or the store was deleted): fall through.
    }
  }
  if (!storeId) {
    let token: string | undefined;
    do {
      const page = await base.listStores({ pageSize: 100, continuationToken: token });
      storeId = page.stores.find((s) => s.name === cfg.name)?.id;
      token = page.continuation_token || undefined;
    } while (!storeId && token);
  }
  storeId ??= (await base.createStore({ name: cfg.name })).id;
  const client = new OpenFgaClient({ apiUrl: cfg.url, credentials, storeId });
  const id = storeId;

  return {
    storeId: id,
    async hasModel() {
      try {
        return !!(await client.readLatestAuthorizationModel()).authorization_model;
      } catch {
        return false;
      }
    },
    async readManaged() {
      const out: Tuple[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await client.read({}, { pageSize: 100, continuationToken });
        for (const t of page.tuples) {
          const k = { user: t.key.user, relation: t.key.relation, object: t.key.object };
          if (isManaged(k)) out.push(k);
        }
        continuationToken = page.continuation_token || undefined;
      } while (continuationToken);
      return out;
    },
    async write(writes, deletes) {
      // OpenFGA takes at most 100 tuples per write; the SDK chunks non-transactional writes.
      if (!writes.length && !deletes.length) return;
      await client.write(
        { writes: writes.length ? writes : undefined, deletes: deletes.length ? deletes : undefined },
        {
          transaction: { disable: true, maxPerChunk: 50 },
          conflict: { onDuplicateWrites: ClientWriteRequestOnDuplicateWrites.Ignore, onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore },
        },
      );
    },
  };
}
