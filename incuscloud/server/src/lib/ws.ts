import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type WebSocketType from "ws";
import type { WebSocketServer as WebSocketServerType } from "ws";

// The ws package itself, loaded by path: a bare "ws" import is Bun's built-in
// client, which ignores the pinned agent (no pin, no client certificate).
const require_ = createRequire(import.meta.url);
const ws = require_(join(dirname(require_.resolve("ws/package.json")), "index.js")) as typeof WebSocketType & { WebSocketServer: typeof WebSocketServerType };

export const WebSocket = ws;
export type WebSocket = WebSocketType;
export const WebSocketServer = ws.WebSocketServer;
