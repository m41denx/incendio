import type { FC } from "react";
import { Spinner, useNotify } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { fetchDebugProcesses } from "api/os";
import NotificationRow from "components/NotificationRow";
import { queryKeys } from "util/queryKeys";

interface Props {
  target: string;
}

const OSDebugProcesses: FC<Props> = ({ target }) => {
  const notify = useNotify();

  const {
    data: processes = "",
    isLoading,
    error,
  } = useQuery({
    queryKey: [queryKeys.osProcesses, target],
    queryFn: async () => fetchDebugProcesses(target),
  });

  if (error) {
    notify.failure("Loading processes failed", error);
  }

  return (
    <>
      <NotificationRow />
      {isLoading && (
        <Spinner className="u-loader" text="Loading processes..." />
      )}
      {!isLoading && !error && (
        <pre>
          <code>{processes}</code>
        </pre>
      )}
    </>
  );
};

export default OSDebugProcesses;
