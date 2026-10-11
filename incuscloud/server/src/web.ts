import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { inside, isFile, notFound, sendFile } from "./lib/static.ts";

// Paths that belong to the server, never to the platform UI.
const SERVER_PATHS = /^\/(?:api|auth)(?:\/|$)|^\/healthz$/;

/**
 * The platform UI (`incuscloud/web` build) at `/`: files as they are, any other
 * page path → index.html so deep links survive a reload. Returns false for
 * requests that are not the UI's (API, sign-in, non-GET).
 */
export function serveWeb(req: IncomingMessage, res: ServerResponse, o: { dir: string }): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = (req.url ?? "/").split("?")[0]!;
  if (SERVER_PATHS.test(path)) return false;
  const root = resolve(o.dir);
  const file = inside(root, path.slice(1) || "index.html");
  if (!file) {
    notFound(res);
    return true;
  }
  if (isFile(file)) sendFile(req, res, root, file);
  else if (!extname(file)) sendFile(req, res, root, resolve(root, "index.html"));
  else notFound(res);
  return true;
}
