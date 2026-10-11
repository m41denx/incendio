import type { Tuple } from "../authz/platform.ts";
import type { ClusterStore, ClusterStoreConfig } from "./cluster-store.ts";
import { isManaged } from "./grants.ts";

/** In-memory OpenFGA stores for reconciler tests; `model` mimics Incus having uploaded its model. */
export class FakeStores {
  stores = new Map<string, { name: string; model: boolean; tuples: Map<string, Tuple> }>();
  opened: ClusterStoreConfig[] = [];
  private n = 0;

  open = async (cfg: ClusterStoreConfig): Promise<ClusterStore> => {
    this.opened.push(cfg);
    let id = cfg.storeId && this.stores.has(cfg.storeId) ? cfg.storeId : [...this.stores].find(([, s]) => s.name === cfg.name)?.[0];
    if (!id) {
      id = `store-${++this.n}`;
      this.stores.set(id, { name: cfg.name, model: false, tuples: new Map() });
    }
    const s = this.stores.get(id)!;
    const key = (t: Tuple) => `${t.user}|${t.relation}|${t.object}`;
    return {
      storeId: id,
      hasModel: async () => s.model,
      readManaged: async () => [...s.tuples.values()].filter(isManaged),
      write: async (writes, deletes) => {
        for (const t of writes) s.tuples.set(key(t), t);
        for (const t of deletes) s.tuples.delete(key(t));
      },
    };
  };

  /** All tuples of the store with this name, as "user relation object" lines, sorted. */
  lines(name: string): string[] {
    const s = [...this.stores.values()].find((x) => x.name === name);
    return s ? [...s.tuples.values()].map((t) => `${t.user} ${t.relation} ${t.object}`).sort() : [];
  }
}
