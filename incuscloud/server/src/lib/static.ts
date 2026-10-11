import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";

export const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `rel` (URL-encoded, relative) resolved inside `root`, or null when it escapes or cannot be decoded. */
export function inside(root: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  const r = resolve(root);
  const file = resolve(r, decoded);
  return file === r || file.startsWith(r + sep) ? file : null;
}

export function notFound(res: ServerResponse) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

/** Sends a file: content-hashed `<root>/assets/*` cached forever, everything else revalidated. */
export function sendFile(req: IncomingMessage, res: ServerResponse, root: string, file: string) {
  const asset = file.startsWith(resolve(root, "assets") + sep);
  res.writeHead(200, {
    "content-type": Bun.file(file).type,
    "cache-control": asset ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}
