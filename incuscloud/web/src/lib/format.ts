/** Shown for values the cluster did not report. */
export const UNKNOWN = "—";

const UNITS = ["KiB", "MiB", "GiB", "TiB", "PiB"];

/** Bytes in binary units: "512 B", "1.5 KiB". */
export function bytes(n: number | null | undefined): string {
  if (n == null) return UNKNOWN;
  if (n < 1024) return `${n} B`;
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${UNITS[i]}`;
}

/** Bytes per second. */
export const rate = (n: number | null | undefined) => (n == null ? UNKNOWN : `${bytes(Math.round(n))}/s`);

/** CPU use in cores, two decimals. */
export const cores = (n: number | null | undefined) => (n == null ? UNKNOWN : n.toFixed(2));

/** used / total as a whole percentage. */
export const percent = (used: number | null | undefined, total: number | null | undefined) => (used == null || !total ? UNKNOWN : `${Math.round((used / total) * 100)}%`);
