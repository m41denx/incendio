import type { FC } from "react";

const APPEARANCE: Record<string, string> = { ready: "positive", degraded: "caution", pending: "caution", error: "negative" };

/** Status label; the reconciler's message, if any, as its tooltip. */
const ClusterStatus: FC<{ status: string; message?: string }> = ({ status, message }) => {
  const a = APPEARANCE[status];
  return (
    <span className={a ? `p-status-label--${a}` : "p-status-label"} title={message || undefined}>
      {status[0]?.toUpperCase()}
      {status.slice(1)}
    </span>
  );
};

export default ClusterStatus;
