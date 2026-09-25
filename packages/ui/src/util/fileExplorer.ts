// Path and metadata helpers shared by the instance and storage-volume file
// explorers (both backed by the Incus file API: GET lists a directory or
// returns a file, HEAD returns metadata headers, POST writes, DELETE removes).

export const joinPath = (parent: string, name: string): string =>
  parent === "/" ? `/${name}` : `${parent}/${name}`;

export const baseName = (path: string): string =>
  path.split("/").filter(Boolean).at(-1) ?? "/";

/** "/a/b" → ["/", "/a", "/a/b"], for breadcrumbs. */
export const pathAncestors = (path: string): string[] => {
  const segments = path.split("/").filter(Boolean);
  return [
    "/",
    ...segments.map((_, i) => `/${segments.slice(0, i + 1).join("/")}`),
  ];
};

/**
 * File API metadata header. Incus sends X-Incus-*, LXD X-LXD-*; reading only
 * the LXD name left every entry "unknown" on Incus (no folder navigation).
 */
export const fileHeader = (headers: Headers, key: string): string | null =>
  headers.get(`x-incus-${key}`) ?? headers.get(`x-lxd-${key}`);

// Go's time.Time.String(): "2026-09-24 16:50:04.123456789 +0000 UTC"
const GO_TIME =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)? ([+-]\d{2})(\d{2})(?: \S+)?$/;

/** The modified header as a Date (Go time string or ISO), null if unparsable. */
export const parseFileModified = (value: string | null): Date | null => {
  if (!value) return null;
  const go = GO_TIME.exec(value.trim());
  const iso = go
    ? `${go[1]}T${go[2]}${(go[3] ?? "").slice(0, 4)}${go[4]}:${go[5]}`
    : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Why `name` cannot be a new entry in a directory holding `existing`, or null.
 * The file API takes a full path, so a "/" would silently create elsewhere.
 */
export const newEntryNameError = (
  name: string,
  existing: readonly string[],
): string | null => {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name";
  if (trimmed.includes("/")) return "Names cannot contain /";
  if (trimmed === "." || trimmed === "..") return "Choose another name";
  if (existing.includes(trimmed)) return `${trimmed} already exists here`;
  return null;
};
