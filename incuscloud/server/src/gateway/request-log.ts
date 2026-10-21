import type { Db } from "../db/index.ts";
import { gatewayRequests } from "../db/schema.ts";
import { log } from "../lib/log.ts";
import type { GatewayRequest } from "./handler.ts";

type Row = typeof gatewayRequests.$inferInsert;

/**
 * Batched, best-effort log of gateway requests (spec §3.3.7). Changes and
 * upgrades are always kept; reads are kept with probability `sampleReads`.
 * Query strings are dropped: operation websockets carry their secret there.
 */
export class RequestLog {
  private batch: Row[] = [];
  private timer: ReturnType<typeof setInterval>;
  private readonly sampleReads: number;
  private readonly maxBatch: number;
  private readonly random: () => number;

  constructor(
    private readonly db: Db,
    o: { sampleReads: number; flushMs?: number; maxBatch?: number; random?: () => number },
  ) {
    this.sampleReads = o.sampleReads;
    this.maxBatch = o.maxBatch ?? 200;
    this.random = o.random ?? Math.random;
    this.timer = setInterval(() => void this.flush(), o.flushMs ?? 1000);
    this.timer.unref?.();
  }

  record(r: GatewayRequest): void {
    const read = !r.upgrade && (r.method === "GET" || r.method === "HEAD");
    if (read && !(this.sampleReads > 0 && this.random() < this.sampleReads)) return;
    this.batch.push({
      clusterId: r.cluster.id,
      actorType: r.principal?.kind ?? "anonymous",
      actorId: r.principal?.id ?? "",
      method: r.method,
      path: r.path.split("?")[0]!.slice(0, 512),
      status: r.status,
      bytesIn: r.bytesIn,
      bytesOut: r.bytesOut,
      durationMs: r.durationMs,
      ip: r.ip,
    });
    if (this.batch.length >= this.maxBatch) void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.batch.length) return;
    const rows = this.batch;
    this.batch = [];
    try {
      await this.db.insert(gatewayRequests).values(rows);
    } catch (e) {
      log.warn("gateway request log write failed; rows dropped", { rows: rows.length, error: String(e) });
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
