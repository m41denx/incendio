import type WebSocket from "ws";
import type { IncusAdminClient, IncusResponse } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import type { TargetRequest } from "./preflight.ts";

/** What the transfer needs from a cluster's admin client. */
export type TransferSide = Pick<IncusAdminClient, "url" | "request" | "websocket" | "cancel">;

export interface TransferOptions {
  src: TransferSide;
  dst: TransferSide;
  srcProject: string;
  dstProject: string;
  /** The source instance's name. */
  name: string;
  /** The target's `POST /1.0/instances` body (pre-flight's request, plus any tags). */
  request: TargetRequest;
  /** Update an existing target with what changed (replication). */
  refresh: boolean;
  live: boolean;
  /** Leave snapshots behind. */
  instanceOnly: boolean;
  /** The target cluster's certificate, for the source to pin when it connects. */
  targetCert: string;
  /**
   * direct: the source connects to the target (Incus push mode; pull mode is
   * refused in restricted projects). relay: the control plane carries the
   * data. auto: direct, and relay when the source cannot reach the target.
   */
  transport: "auto" | "direct" | "relay";
  signal: AbortSignal;
  onProgress: (text: string) => Promise<void>;
}

const HIGH = 4 << 20;
const POLL_S = 2;
// A source that cannot reach the target says so in one of these ways.
const UNREACHABLE = /unable to connect|dial tcp|connection refused|no route to host|i\/o timeout|network is unreachable|context deadline exceeded/i;

/**
 * Forwards one websocket's messages to another, one message at a time (the
 * control socket's framing must survive), pausing the reader while more than
 * 4 MiB waits to be sent on the other side.
 */
export function forward(from: WebSocket, to: WebSocket) {
  from.on("message", (data, binary) => {
    if (to.readyState !== 1) return;
    to.send(data as Buffer, { binary }, () => {
      if (from.isPaused && to.bufferedAmount < HIGH / 2) from.resume();
    });
    if (to.bufferedAmount > HIGH) from.pause();
  });
}

/** Relays two websockets both ways until either closes; then closes both. */
export function pipe(a: WebSocket, b: WebSocket): Promise<void> {
  return new Promise((done) => {
    forward(a, b);
    forward(b, a);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      a.close();
      b.close();
      done();
    };
    a.on("close", end);
    b.on("close", end);
    a.on("error", end);
    b.on("error", end);
  });
}

/** A line of progress from an operation's metadata, in the shapes Incus uses. */
export function progressText(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const m = meta as Record<string, unknown>;
  const p = m.progress as { percent?: string; speed?: string } | undefined;
  if (p?.percent) return `${p.percent}%${p.speed ? ` (${p.speed})` : ""}`;
  for (const [k, v] of Object.entries(m)) if (k.endsWith("progress") && typeof v === "string") return v;
  return undefined;
}

type Op = { id: string; path: string; secrets: Record<string, string> };
const opOf = (r: IncusResponse<{ id: string; metadata: Record<string, string> | null }>): Op => ({
  id: r.metadata.id,
  path: r.operation ?? `/1.0/operations/${r.metadata.id}`,
  secrets: r.metadata.metadata ?? {},
});

class TargetFailed extends ApiError {
  constructor(readonly reason: string) {
    super(502, "migration_failed", `Target: ${reason}`);
  }
}
class SourceFailed extends ApiError {
  constructor(readonly reason: string) {
    super(502, "migration_failed", `Source: ${reason}`);
  }
}

/**
 * Moves an instance's data from one cluster to another as Incus migration:
 * the source connects to the target, or the control plane relays the
 * operation websockets between them (spike C). The target always waits in
 * push mode. Resolves once the target has the instance; the caller decides
 * what happens to the source.
 */
export async function transfer(o: TransferOptions): Promise<{ transport: "direct" | "relay" }> {
  const startSource = async (extra: Record<string, unknown> = {}) => {
    try {
      return opOf(await o.src.request("POST", `/1.0/instances/${encodeURIComponent(o.name)}?project=${encodeURIComponent(o.srcProject)}`, { migration: true, live: o.live, instance_only: o.instanceOnly, ...extra }));
    } catch (e) {
      throw new SourceFailed((e as Error).message);
    }
  };
  const startTarget = async () => {
    try {
      return opOf(
        await o.dst.request("POST", `/1.0/instances?project=${encodeURIComponent(o.dstProject)}`, {
          ...o.request,
          source: { type: "migration", mode: "push", refresh: o.refresh, live: o.live, instance_only: o.instanceOnly },
        }),
      );
    } catch (e) {
      throw new TargetFailed((e as Error).message);
    }
  };

  /** Waits for the target operation (and the source's, when it runs on its own), reporting progress. */
  const waitTarget = async (dst: Op, src?: Op) => {
    for (;;) {
      if (o.signal.aborted) throw o.signal.reason;
      if (src) {
        const s = (await o.src.request<{ status: string; err: string }>("GET", src.path)).metadata;
        if (s.status === "Failure" || s.status === "Cancelled") throw new SourceFailed(s.err || s.status);
      }
      const r = await o.dst.request<{ status: string; err: string; metadata: unknown }>("GET", `${dst.path}/wait?timeout=${POLL_S}`);
      const { status, err, metadata } = r.metadata;
      if (status === "Success") return;
      if (status === "Failure" || status === "Cancelled") throw new TargetFailed(err || status);
      const text = progressText(metadata);
      if (text) await o.onProgress(text);
    }
  };

  const direct = async () => {
    const dst = await startTarget();
    let src: Op | undefined;
    try {
      src = await startSource({ target: { operation: `${o.dst.url}/1.0/operations/${dst.id}`, certificate: o.targetCert, secrets: dst.secrets } });
      await waitTarget(dst, src);
    } catch (e) {
      await Promise.allSettled([src && !(e instanceof SourceFailed) ? o.src.cancel(src.path) : undefined, e instanceof TargetFailed ? undefined : o.dst.cancel(dst.path)]);
      throw e;
    }
  };

  const relay = async () => {
    const src = await startSource();
    let dst: Op;
    try {
      dst = await startTarget();
    } catch (e) {
      await o.src.cancel(src.path).catch(() => {});
      throw e;
    }
    const sockets: WebSocket[] = [];
    const pipes: Promise<void>[] = [];
    try {
      const names = ["control", ...Object.keys(src.secrets).filter((n) => n !== "control")].filter((n) => src.secrets[n] && dst.secrets[n]);
      for (const n of names) {
        const [a, b] = await Promise.all([
          o.src.websocket(`/1.0/operations/${src.id}/websocket?secret=${encodeURIComponent(src.secrets[n]!)}`),
          o.dst.websocket(`/1.0/operations/${dst.id}/websocket?secret=${encodeURIComponent(dst.secrets[n]!)}`),
        ]);
        sockets.push(a, b);
        pipes.push(pipe(a, b));
      }
      await waitTarget(dst);
    } catch (e) {
      await Promise.allSettled([o.src.cancel(src.path), e instanceof TargetFailed ? undefined : o.dst.cancel(dst.path)]);
      throw e;
    } finally {
      for (const s of sockets) s.close();
      await Promise.all(pipes);
    }
  };

  if (o.transport === "relay") {
    await relay();
    return { transport: "relay" };
  }
  try {
    await direct();
    return { transport: "direct" };
  } catch (e) {
    if (o.transport === "auto" && !o.signal.aborted && e instanceof SourceFailed && UNREACHABLE.test(e.reason)) {
      await o.onProgress("The source cannot reach the target; relaying through the control plane");
      await relay();
      return { transport: "relay" };
    }
    throw e;
  }
}
