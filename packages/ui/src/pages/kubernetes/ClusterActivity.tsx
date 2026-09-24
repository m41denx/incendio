import { useEffect, useRef, useState, type FC } from "react";
import { CheckboxInput, Icon, Spinner } from "@canonical/react-components";
import {
  useK8sClusterActivity,
  type K8sActivityEntry,
} from "pages/kubernetes/useK8sClusters";

const LEVEL_ICON: Record<K8sActivityEntry["level"], string> = {
  info: "status-succeeded-small",
  warning: "warning",
  error: "status-failed-small",
};

// Poll while CAPI is changing the cluster; settle once it is ready.
const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 30_000;

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour12: false });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
};

interface Props {
  name: string;
  status: string;
  /** The agent serves /activity (0.2.0+). */
  supported: boolean;
}

// Live provisioning log: Events on the cluster's CAPI objects and the
// provider controllers' log lines about it, merged by the agent.
const ClusterActivity: FC<Props> = ({ name, status, supported }) => {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const { data, error, isLoading } = useK8sClusterActivity(
    name,
    supported,
    status === "ready" ? SLOW_POLL_MS : FAST_POLL_MS,
  );
  const listRef = useRef<HTMLOListElement>(null);
  const followRef = useRef(true);

  const entries = (data ?? []).filter(
    (entry) => !problemsOnly || entry.level !== "info",
  );
  const newest = entries.at(-1)?.time;
  const repeats = entries.reduce((sum, entry) => sum + entry.count, 0);

  // Keep the newest line in view, unless the user scrolled up to read.
  useEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) list.scrollTop = list.scrollHeight;
  }, [newest, entries.length, repeats]);

  if (!supported) {
    return (
      <p className="u-text--muted">
        Update the Kubernetes agent (Kubernetes settings → Management appliance)
        to see the cluster&apos;s provisioning activity here.
      </p>
    );
  }
  if (isLoading) return <Spinner text="Loading activity..." />;
  if (error) {
    return (
      <p className="u-text--muted">
        Activity is not available right now: {error.message}
      </p>
    );
  }

  return (
    <>
      <CheckboxInput
        label="Warnings and errors only"
        checked={problemsOnly}
        onChange={() => {
          setProblemsOnly((value) => !value);
        }}
      />
      {entries.length === 0 ? (
        <p className="u-text--muted">
          {problemsOnly
            ? "No warnings or errors."
            : "No activity recorded yet. Kubernetes keeps events for an hour, and controller logs since their last restart."}
        </p>
      ) : (
        <ol
          className="k8s-activity"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            followRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {entries.map((entry, i) => (
            <li
              key={`${entry.time}-${entry.source}-${String(i)}`}
              className={`k8s-activity__entry is-${entry.level}`}
            >
              <span
                className="k8s-activity__time u-text--muted"
                title={new Date(entry.time).toLocaleString()}
              >
                {formatTime(entry.time)}
              </span>
              <Icon name={LEVEL_ICON[entry.level]} />
              <span className="k8s-activity__body">
                <span className="k8s-activity__meta u-text--muted">
                  {entry.source}
                  {entry.object ? ` · ${entry.object}` : ""}
                </span>
                <span className="k8s-activity__message">
                  {entry.message}
                  {entry.count > 1 ? (
                    <span
                      className="u-text--muted"
                      title={
                        entry.lastTime
                          ? `Last at ${new Date(entry.lastTime).toLocaleString()}`
                          : undefined
                      }
                    >
                      {" "}
                      ×{entry.count}
                      {entry.lastTime
                        ? `, last ${formatTime(entry.lastTime)}`
                        : ""}
                    </span>
                  ) : null}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
};

export default ClusterActivity;
