import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusters } from "../db/schema.ts";
import type { ClusterRow } from "../clusters/enroll.ts";

/** Clusters by name for the gateway's hot path; a short TTL bounds staleness across replicas. */
export class ClusterCache {
  private entries = new Map<string, { row: ClusterRow | null; at: number }>();
  constructor(
    private readonly db: Db,
    private readonly ttlMs = 5000,
  ) {}

  async get(name: string): Promise<ClusterRow | null> {
    const hit = this.entries.get(name);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.row;
    const [row] = await this.db.select().from(clusters).where(eq(clusters.name, name));
    this.entries.set(name, { row: row ?? null, at: Date.now() });
    return row ?? null;
  }

  invalidate(name?: string) {
    if (name) this.entries.delete(name);
    else this.entries.clear();
  }
}
