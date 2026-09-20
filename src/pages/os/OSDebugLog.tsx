import { useState, type FC } from "react";
import { Button, Input, Spinner, useNotify } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { fetchDebugLogs, type DebugLogOptions } from "api/os";
import NotificationRow from "components/NotificationRow";
import type { IncusOSLog } from "types/os";
import { queryKeys } from "util/queryKeys";

function formatTimestamp(us: string) {
  const ms = Number(us) / 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function JournalLine(item: IncusOSLog) {
  const ts = formatTimestamp(item.__REALTIME_TIMESTAMP);
  const host = item._HOSTNAME ?? "";
  const ident = item.SYSLOG_IDENTIFIER ?? item._COMM ?? "unknown";
  const pid = item._PID ? `[${item._PID}]` : "";
  const msg = item.MESSAGE ?? "";

  return (
    <>
      {ts} {host} {ident}
      {pid}: {msg}
      <br />
    </>
  );
}

interface Props {
  target: string;
}

const OSDebugLog: FC<Props> = ({ target }) => {
  const notify = useNotify();
  const [unit, setUnit] = useState("");
  const [boot, setBoot] = useState("");
  const [entries, setEntries] = useState("200");
  const [filters, setFilters] = useState<DebugLogOptions>({ entries: 200 });

  const {
    data: logs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [queryKeys.osDebugLogs, target, filters],
    queryFn: async () => fetchDebugLogs(target, filters),
  });

  const applyFilters = () => {
    setFilters({
      unit: unit,
      boot: boot,
      entries: entries ? Number(entries) : undefined,
    });
  };

  if (error) {
    notify.failure("Loading logs failed", error);
  }

  return (
    <>
      <NotificationRow />
      <form
        className="incusos-log-filters"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
      >
        <Input
          type="text"
          label="Unit"
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value);
          }}
        />
        <Input
          type="text"
          label="Boot"
          value={boot}
          onChange={(e) => {
            setBoot(e.target.value);
          }}
        />
        <Input
          type="number"
          label="Entries"
          value={entries}
          onChange={(e) => {
            setEntries(e.target.value);
          }}
        />
        <Button type="submit" appearance="positive">
          Apply
        </Button>
      </form>

      {isLoading && <Spinner className="u-loader" text="Loading logs..." />}
      {!isLoading && logs.length === 0 && (
        <div className="u-align-text--center">There are no logs.</div>
      )}
      {!isLoading && logs.length > 0 && (
        <pre>
          <code>
            {logs?.map((item, i) => (
              <span key={i}>{JournalLine(item)}</span>
            ))}
          </code>
        </pre>
      )}
    </>
  );
};

export default OSDebugLog;
