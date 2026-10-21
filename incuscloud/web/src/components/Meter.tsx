import type { FC } from "react";
import IncendioMeter from "@incendio/ui/components/Meter";
import { UNKNOWN, bytes, percent } from "../lib/format";

/** Incendio's meter for used / total, as an accessible meter; without a total there is nothing to show but UNKNOWN. */
const Meter: FC<{ used: number | null | undefined; total: number | null | undefined; label?: string; format?: (n: number) => string }> = ({ used, total, label, format = bytes }) => {
  if (used == null || !total) return <>{UNKNOWN}</>;
  const ratio = Math.min(Math.max(used / total, 0), 1);
  const text = `${format(used)} / ${format(total)} (${percent(used, total)})`;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-valuetext={text}>
      <IncendioMeter percentage={ratio * 100} text={text} />
    </div>
  );
};

export default Meter;
