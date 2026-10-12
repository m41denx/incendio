import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { PinnedAgent } from "@incendio/api/node";
import { log } from "../lib/log.ts";
import { WebSocket, WebSocketServer } from "../lib/ws.ts";
import { qualifyResponse } from "./rewrite.ts";

export interface EventSource {
  cluster: string;
  url: string;
  agent: PinnedAgent;
  /** `/1.0/events?…`, stripped for this cluster. */
  path: string;
  token: string;
  standalone: boolean;
}

const server = new WebSocketServer({ noServer: true });

/**
 * `/1.0/events` over every reachable cluster: one upstream socket each,
 * every event qualified with its cluster. The caller's socket closes once
 * no cluster is left (Incendio then reconnects and refetches).
 */
export function fanInEvents(req: IncomingMessage, socket: Duplex, head: Buffer, sources: EventSource[]) {
  server.handleUpgrade(req, socket, head, (client) => {
    const open = new Set<InstanceType<typeof WebSocket>>();
    const done = () => {
      for (const u of open) u.terminate();
      open.clear();
    };
    client.on("close", done);
    client.on("error", done);
    for (const s of sources) {
      const up = new WebSocket(s.url.replace(/^https:/, "wss:") + s.path, { agent: s.agent, headers: { authorization: `Bearer ${s.token}` }, handshakeTimeout: 10_000, maxPayload: 0 });
      open.add(up);
      up.on("message", (data: Buffer, binary: boolean) => {
        if (binary || client.readyState !== client.OPEN) return;
        try {
          client.send(JSON.stringify(qualifyResponse("/1.0/events", JSON.parse(data.toString("utf8")), s.cluster, { standalone: s.standalone })));
        } catch {}
      });
      const gone = (why: unknown) => {
        if (!open.delete(up)) return;
        if (why) log.info("facade: event stream ended", { cluster: s.cluster, error: String(why) });
        if (!open.size && client.readyState === client.OPEN) client.close(1011, "No cluster is streaming events");
      };
      up.on("close", () => gone(null));
      up.on("error", gone);
    }
  });
}
