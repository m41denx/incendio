import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Route } from "./route.ts";

const notFound = (res: ServerResponse) => {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
};

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

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
  let rel: string;
  try {
    rel = decodeURIComponent(pathOnly.slice("/ui/".length));
  } catch {
    return notFound(res);
  }
  const root = resolve(o.uiDir);
  const file = resolve(root, rel || "index.html");
  if (file !== root && !file.startsWith(root + sep)) return notFound(res);

  const isPage = !extname(rel) || rel.endsWith(".html");
  if (isPage && !o.signedIn) {
    res.writeHead(302, { location: `/auth/start?return_to=${encodeURIComponent(req.url ?? `${prefix}/ui/`)}` });
    return res.end();
  }
  const target = isFile(file) ? file : !extname(rel) ? resolve(root, "index.html") : null;
  if (!target || !isFile(target)) return notFound(res);

  const asset = target.startsWith(resolve(root, "assets") + sep);
  res.writeHead(200, {
    "content-type": Bun.file(target).type,
    "cache-control": asset ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(target).pipe(res);
}
