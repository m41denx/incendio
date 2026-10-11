import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import type { Route } from "./route.ts";
import { inside, isFile, notFound, sendFile } from "../lib/static.ts";

/**
 * Serves Incendio for one cluster at `/clusters/<name>/ui/`. Incendio takes
 * its API root from the URL (everything before `/ui/`), so its calls go
 * through the gateway with the browser session.
 */
export function serveUi(req: IncomingMessage, res: ServerResponse, route: Route, o: { uiDir: string; signedIn: boolean }) {
  const prefix = `/clusters/${route.name}`;
  const pathOnly = route.path.split("?")[0]!;
  if (pathOnly === "/ui") {
    res.writeHead(301, { location: `${prefix}/ui/` });
    return res.end();
  }
  const rel = pathOnly.slice("/ui/".length);
  const root = resolve(o.uiDir);
  const file = inside(root, rel || "index.html");
  if (!file) return notFound(res);
  const isPage = !extname(rel) || rel.endsWith(".html");
  if (isPage && !o.signedIn) {
    res.writeHead(302, { location: `/auth/start?return_to=${encodeURIComponent(req.url ?? `${prefix}/ui/`)}` });
    return res.end();
  }
  const target = isFile(file) ? file : !extname(rel) ? resolve(root, "index.html") : null;
  if (!target || !isFile(target)) return notFound(res);

  sendFile(req, res, root, target);
}
