import { eq, ne } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, clusters, serviceAccounts, users } from "../db/schema.ts";
import { entriesUnder, moveEntries } from "./entries.ts";
import { clusterClient, type ClusterRow } from "../clusters/enroll.ts";
import type { WebSocket } from "../lib/ws.ts";
import { log } from "../lib/log.ts";
import { forgetOwned, recordOwner, renameOwned } from "./owners.ts";
import { forgetLease, renameLease } from "../leases/leases.ts";

interface LifecycleEvent {
  type?: string;
  metadata?: { action?: string; name?: string; project?: string; context?: { old_name?: string }; requestor?: { username?: string; protocol?: string } };
}

/** The permission path of an instance in this cluster's project, by name. */
async function instancePath(db: Db, clusterId: string, project: string) {
  const [c] = await db.select({ name: clusters.name }).from(clusters).where(eq(clusters.id, clusterId));
  return c ? (name: string) => `/clusters/${c.name}/projects/${project}/instances/${name}` : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The IncusCloud subject behind an OIDC requestor (Incus's user name is the token's `sub`): a user id, or a service account's clientId. */
async function subjectOf(db: Db, requestor: { username?: string; protocol?: string } | undefined): Promise<string | null> {
  const name = requestor?.username;
  if (requestor?.protocol !== "oidc" || !name) return null;
  if (UUID.test(name) && (await db.select({ id: users.id }).from(users).where(eq(users.id, name))).length) return `user:${name}`;
  const [sa] = await db.select({ id: serviceAccounts.id }).from(serviceAccounts).where(eq(serviceAccounts.clientId, name));
  return sa ? `service:${sa.id}` : null;
}

/**
 * Applies one lifecycle event to the owners: a create by an IncusCloud
 * subject records it; a rename re-keys; a delete forgets. Creates by
 * certificate are IncusCloud's own jobs, which record their owner
 * themselves. Returns whether owners changed.
 */
export async function onLifecycle(db: Db, clusterId: string, event: LifecycleEvent): Promise<boolean> {
  const m = event.metadata;
  if (event.type !== "lifecycle" || !m?.name || !m.project) return false;
  const key = { clusterId, project: m.project, name: m.name };
  switch (m.action) {
    case "instance-created": {
      const subject = await subjectOf(db, m.requestor);
      if (!subject) return false;
      await recordOwner(db, key, subject, "event");
      return true;
    }
    case "instance-renamed": {
      if (!m.context?.old_name) return false;
      await renameOwned(db, { ...key, name: m.context.old_name }, key);
      await renameLease(db, { ...key, name: m.context.old_name }, key);
      const at = await instancePath(db, clusterId, m.project);
      if (at) await moveEntries(db, at(m.context.old_name), at(m.name));
      return true;
    }
    case "instance-deleted": {
      await forgetOwned(db, key);
      await forgetLease(db, key);
      // Its permission entries go too: a later instance of that name starts clean.
      const at = await instancePath(db, clusterId, m.project);
      if (at) await db.delete(aclEntries).where(entriesUnder(at(m.name)));
      return true;
    }
    default:
      return false;
  }
}

interface Options {
  /** How often to follow enrolments, deletions and disabled clusters. */
  refreshMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  connect?: (row: ClusterRow) => Promise<WebSocket>;
}

interface Stream {
  ws?: WebSocket;
  backoff: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * One lifecycle event stream per enabled cluster (admin certificate, every
 * project), reconnecting with backoff. Events missed while a stream is
 * down are covered by the inventory's backfill.
 */
export class Lifecycle {
  private readonly streams = new Map<string, Stream>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = true;
  private readonly o: Required<Omit<Options, "connect">> & Pick<Options, "connect">;

  constructor(
    private readonly deps: { db: Db; secretKey: Buffer; onOwnerChange: (clusterId: string) => Promise<void> },
    opts: Options = {},
  ) {
    this.o = { refreshMs: opts.refreshMs ?? 30_000, minBackoffMs: opts.minBackoffMs ?? 1_000, maxBackoffMs: opts.maxBackoffMs ?? 60_000, connect: opts.connect };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const refresh = () => void this.refresh().catch((e) => log.warn("lifecycle refresh failed", { error: (e as Error).message }));
    refresh();
    this.timer = setInterval(refresh, this.o.refreshMs);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    for (const s of this.streams.values()) {
      clearTimeout(s.timer);
      s.ws?.terminate();
    }
    this.streams.clear();
  }

  /** Opens streams for new clusters and closes those of deleted or disabled ones. */
  async refresh(): Promise<void> {
    const rows = await this.deps.db.select().from(clusters).where(ne(clusters.status, "disabled"));
    const wanted = new Set(rows.map((r) => r.id));
    for (const [id, s] of this.streams) {
      if (wanted.has(id)) continue;
      clearTimeout(s.timer);
      s.ws?.terminate();
      this.streams.delete(id);
    }
    for (const row of rows) if (!this.streams.has(row.id)) this.open(row, { backoff: this.o.minBackoffMs });
  }

  private open(row: ClusterRow, state: { backoff: number }): void {
    if (this.stopped) return;
    const s: Stream = { backoff: state.backoff };
    this.streams.set(row.id, s);
    const connect = this.o.connect ?? ((r: ClusterRow) => clusterClient(this.deps, r).websocket("/1.0/events?type=lifecycle&all-projects=true"));
    connect(row).then(
      (ws) => {
        if (this.stopped || this.streams.get(row.id) !== s) return void ws.terminate();
        s.ws = ws;
        s.backoff = this.o.minBackoffMs;
        ws.on("message", (data: Buffer) => {
          let event: LifecycleEvent;
          try {
            event = JSON.parse(data.toString("utf8"));
          } catch {
            return;
          }
          onLifecycle(this.deps.db, row.id, event)
            .then((changed) => (changed ? this.deps.onOwnerChange(row.id) : undefined))
            .catch((e) => log.warn("lifecycle event failed", { cluster: row.name, error: (e as Error).message }));
        });
        ws.on("error", () => {});
        ws.on("close", () => this.retry(row, s));
      },
      (e) => {
        // A cluster that stays down is reported once, then quietly retried.
        (s.backoff === this.o.minBackoffMs ? log.warn : log.debug)("lifecycle stream failed", { cluster: row.name, error: (e as Error).message });
        this.retry(row, s);
      },
    );
  }

  private retry(row: ClusterRow, s: Stream): void {
    if (this.stopped || this.streams.get(row.id) !== s) return;
    s.timer = setTimeout(() => {
      if (this.streams.get(row.id) === s) this.open(row, { backoff: Math.min(s.backoff * 2, this.o.maxBackoffMs) });
    }, s.backoff);
  }
}
