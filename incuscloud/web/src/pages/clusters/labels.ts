/** "k=v" per line (or comma), as typed in a textarea. Blank parts are skipped. */
export function parseLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/[\n,]/)) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i <= 0) throw new Error(`"${t}" is not key=value`);
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

export const formatLabels = (labels: Record<string, string>) =>
  Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
