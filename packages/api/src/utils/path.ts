/** Encodes one path segment (entity names may contain `/`, spaces, …). */
export const seg = (value: string): string => encodeURIComponent(value);

/** Joins path segments, encoding each one: `path("instances", name)` → `/1.0/instances/<name>` */
export const path = (...segments: string[]): string =>
  `/1.0/${segments.map(seg).join("/")}`;

/**
 * Extracts the entity name from an Incus resource URL.
 * `/1.0/instances/foo?project=bar` → `foo`
 */
export const nameFromUrl = (url: string): string => {
  const pathname = url.split("?")[0] ?? url;
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  return decodeURIComponent(last);
};

/**
 * Parses an Incus resource URL into its path segments and query.
 * `/1.0/storage-pools/default/volumes/custom/data?project=p`
 *  → `{ segments: ["storage-pools","default","volumes","custom","data"], project: "p" }`
 */
export const parseResourceUrl = (
  url: string,
): { segments: string[]; project?: string; target?: string } => {
  const [pathname = "", search = ""] = url.split("?");
  const query = new URLSearchParams(search);
  const segments = pathname
    .replace(/^\/1\.0\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  return {
    segments,
    project: query.get("project") ?? undefined,
    target: query.get("target") ?? undefined,
  };
};

/** Extracts the operation UUID from an operation URL or returns the input. */
export const operationId = (idOrUrl: string): string => nameFromUrl(idOrUrl);
