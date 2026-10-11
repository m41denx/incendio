import type { FC } from "react";
import { UNKNOWN, bytes, percent } from "../lib/format";

/** A used / total bar with its values; without a total there is nothing to show but UNKNOWN. */
const Meter: FC<{ used: number | null | undefined; total: number | null | undefined; label?: string; format?: (n: number) => string }> = ({ used, total, label, format = bytes }) => {
  if (used == null || !total) return <>{UNKNOWN}</>;
  const ratio = Math.min(Math.max(used / total, 0), 1);
  // Caution as it nears full, negative when full.
  const level = ratio >= 0.95 ? " ic-meter__fill--negative" : ratio >= 0.8 ? " ic-meter__fill--caution" : "";
  const text = `${format(used)} / ${format(total)} (${percent(used, total)})`;
  return (
    <div className="ic-meter-group">
      <div className="ic-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-valuetext={text}>
        <div className={`ic-meter__fill${level}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="ic-muted">{text}</span>
    </div>
  );
};

export default Meter;
