import type { FC } from "react";

export interface SparkPoint {
  at: string;
  value: number | null;
}

const W = 300;
const H = 48;
const n2 = (x: number) => Number(x.toFixed(2));

/**
 * An SVG path through the points, x by time and y from 0 (bottom) to `max`
 * (top). Missing values break the line; a lone point is drawn as a dot.
 */
export function sparkPath(points: SparkPoint[], w: number, h: number, max: number): string {
  const t0 = new Date(points[0]?.at ?? 0).getTime();
  const span = new Date(points.at(-1)?.at ?? 0).getTime() - t0;
  const scale = max > 0 ? max : 1;
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  for (const p of points) {
    if (p.value == null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    const y = n2(h - (Math.min(p.value, scale) / scale) * h);
    current.push([span > 0 ? n2(((new Date(p.at).getTime() - t0) / span) * w) : 0, y]);
  }
  if (current.length) segments.push(current);
  return segments
    .map((s) => {
      // One point over no time at all spans the box; otherwise a lone point is a dot.
      if (s.length === 1) return span > 0 ? `M${s[0]![0]},${s[0]![1]} L${s[0]![0]},${s[0]![1]}` : `M0,${s[0]![1]} L${w},${s[0]![1]}`;
      return s.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
    })
    .join(" ");
}

/** A small line chart: the latest value, and the history since the first point. `max` fixes the top of the scale. */
const Sparkline: FC<{ label: string; points: SparkPoint[]; format: (n: number) => string; max?: number }> = ({ label, points, format, max }) => {
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  const latest = values.at(-1);
  const top = Math.max(0, ...values);
  return (
    <figure className="ic-spark">
      <figcaption>
        <span className="ic-spark__label">{label}</span>
        {latest != null ? <span className="ic-spark__value">{format(latest)}</span> : null}
      </figcaption>
      {latest == null ? (
        <p className="u-text--muted">No data yet</p>
      ) : (
        <svg className="ic-spark__chart" role="img" aria-label={`${label}: ${format(latest)} now, at most ${format(top)}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={sparkPath(points, W, H, max ?? top)} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </figure>
  );
};

export default Sparkline;
