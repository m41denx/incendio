import type { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

/** An error body Incus clients understand (they print `error`). */
export const incusError = (status: number, message: string) =>
  JSON.stringify({ type: "error", status: "", status_code: 0, operation: "", error_code: status, error: message, metadata: null });

const reason: Record<number, string> = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 502: "Bad Gateway", 503: "Service Unavailable" };

/** Writes an Incus-shaped error as an HTTP response, or onto a raw socket during an upgrade. */
export function writeIncusError(out: ServerResponse | Duplex, status: number, message: string, headers: Record<string, string> = {}) {
  const body = incusError(status, message);
  if ("writeHead" in out) {
    if (out.headersSent) return out.destroy();
    out.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers });
    out.end(body);
    return;
  }
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  out.end(`HTTP/1.1 ${status} ${reason[status] ?? "Error"}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n${extra}connection: close\r\n\r\n${body}`);
}
