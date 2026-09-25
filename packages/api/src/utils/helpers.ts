import type { InstanceSource } from "../api/types/generated";
import type { DeepPartial } from "./types";

/** A config change set: a string sets the key, `null` removes it. */
export type ConfigChanges = Record<string, string | number | boolean | null>;

/** Applies `ConfigChanges` to a copy of `config`. */
export const applyConfig = (
  config: Record<string, string> | undefined,
  changes: ConfigChanges,
): Record<string, string> => {
  const next = { ...config };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next[key];
    else next[key] = String(value);
  }
  return next;
};

/** Where an image remote lives. */
export interface ImageRemote {
  server: string;
  protocol: "simplestreams" | "incus" | "oci";
}

/** Remotes understood in `"remote:alias"` image references. */
export const DEFAULT_REMOTES: Record<string, ImageRemote> = {
  images: {
    server: "https://images.linuxcontainers.org",
    protocol: "simplestreams",
  },
  docker: { server: "https://docker.io", protocol: "oci" },
  ghcr: { server: "https://ghcr.io", protocol: "oci" },
};

const FINGERPRINT = /^[0-9a-f]{12,64}$/;

/**
 * Turns an image reference into an instance `source`:
 * - `"images:debian/12"` — alias on a known remote
 * - `"debian/12"` — local alias
 * - `"a1b2c3…"` — local fingerprint (12+ hex chars)
 * - `null` / `undefined` — empty instance (`type: "none"`)
 */
export const imageSource = (
  image: string | null | undefined,
  remotes: Record<string, ImageRemote> = DEFAULT_REMOTES,
): DeepPartial<InstanceSource> => {
  if (!image) return { type: "none" };
  const colon = image.indexOf(":");
  if (colon > 0) {
    const remoteName = image.slice(0, colon);
    const remote = remotes[remoteName];
    if (!remote) {
      throw new Error(
        `Unknown image remote "${remoteName}" (known: ${Object.keys(remotes).join(", ")})`,
      );
    }
    const ref = image.slice(colon + 1);
    return {
      type: "image",
      mode: "pull",
      server: remote.server,
      protocol: remote.protocol,
      ...(FINGERPRINT.test(ref) ? { fingerprint: ref } : { alias: ref }),
    };
  }
  return FINGERPRINT.test(image)
    ? { type: "image", fingerprint: image }
    : { type: "image", alias: image };
};

const UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
  PIB: 1024 ** 5,
};

/** Parses an Incus size string (`"10GiB"`, `"512MB"`, `"1024"`) into bytes. */
export const parseSize = (size: string): number => {
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
  if (!match) throw new Error(`Invalid size: ${size}`);
  const unit = (match[2] || "B").toUpperCase();
  const factor = UNITS[unit] ?? UNITS[`${unit}B`];
  if (factor === undefined) throw new Error(`Invalid size unit: ${size}`);
  return Math.round(Number(match[1]) * factor);
};

/** Formats bytes as the largest whole binary unit, e.g. `10737418240` → `"10GiB"`. */
export const formatSize = (bytes: number): string => {
  const units = ["PiB", "TiB", "GiB", "MiB", "KiB"] as const;
  for (const unit of units) {
    const factor = UNITS[unit.toUpperCase()]!;
    if (bytes >= factor && bytes % factor === 0)
      return `${bytes / factor}${unit}`;
  }
  return `${bytes}B`;
};

export const toDate = (value: string | null | undefined): Date | null => {
  if (!value || value.startsWith("0001-01-01")) return null;
  return new Date(value);
};
