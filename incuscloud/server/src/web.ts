import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { inside, isFile, notFound, sendFile } from "./lib/static.ts";

// The platform UI loads only its own files; inline styles come from react-components.
// It reads only its own API, and the image servers' catalogues (Incendio's image picker).
// No form-action: signing out POSTs and is redirected to the identity provider.
const csp = (imageServers: string[]) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    ["connect-src 'self'", ...new Set(imageServers.map((u) => new URL(u).origin))].join(" "),
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

// Paths that belong to the server, never to the platform UI.
const SERVER_PATHS = /^\/(?:api|auth)(?:\/|$)|^\/healthz$/;

/**
 * The platform UI (`incuscloud/web` build) at `/`: files as they are, any other
 * page path → index.html so deep links survive a reload. Returns false for
 * requests that are not the UI's (API, sign-in, non-GET).
 */
export function serveWeb(req: IncomingMessage, res: ServerResponse, o: { dir: string; imageServers?: string[] }): boolean {
  const PAGE = { "content-security-policy": csp(o.imageServers ?? []) };
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = (req.url ?? "/").split("?")[0]!;
  if (SERVER_PATHS.test(path)) return false;
  const root = resolve(o.dir);
  const file = inside(root, path.slice(1) || "index.html");
  if (!file) {
    notFound(res);
    return true;
  }
  if (isFile(file)) sendFile(req, res, root, file, file.endsWith(".html") ? PAGE : {});
  else if (!extname(file)) sendFile(req, res, root, resolve(root, "index.html"), PAGE);
  else notFound(res);
  return true;
}
