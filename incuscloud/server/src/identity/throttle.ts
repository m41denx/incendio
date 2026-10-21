/**
 * Counts failed sign-ins per key (email, client IP) in a sliding window.
 * In memory, per replica: it slows guessing down, it is not a global lockout.
 */
export class LoginThrottle {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(o: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
    this.limit = o.limit;
    this.windowMs = o.windowMs;
    this.maxKeys = o.maxKeys ?? 100_000;
    this.now = o.now ?? Date.now;
  }

  get size() {
    return this.hits.size;
  }

  private recent(key: string) {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  /** Seconds until every key may try again; 0 when none is blocked. */
  retryAfterS(keys: string[]): number {
    let wait = 0;
    for (const k of keys) {
      const r = this.recent(k);
      if (r.length >= this.limit) wait = Math.max(wait, Math.ceil((r[r.length - this.limit]! + this.windowMs - this.now()) / 1000));
    }
    return wait;
  }

  fail(keys: string[]) {
    for (const k of keys) {
      if (!this.hits.has(k) && this.hits.size >= this.maxKeys) {
        // Drop the oldest key (Map keeps insertion order).
        this.hits.delete(this.hits.keys().next().value!);
      }
      this.hits.set(k, [...this.recent(k), this.now()]);
    }
  }

  clear(keys: string[]) {
    for (const k of keys) this.hits.delete(k);
  }
}
