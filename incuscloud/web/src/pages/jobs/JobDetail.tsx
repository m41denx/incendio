import { type FC, type ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import { useMe } from "../../api/hooks";
import type { Job } from "../../api/types";
import { UNKNOWN } from "../../lib/format";
import { useClusters } from "../clusters/ClusterList";
import { active, canCancel, CancelJobButton, JobStateLabel, JobType, jobSummary, progressText, resultOf } from "./jobState";

const POLL_MS = 2_000;

/** One job: its state, progress, timing, error and result, and a Cancel control where the caller may cancel it. */
const JobDetail: FC = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const clusters = useClusters();
  const [cancelError, setCancelError] = useState<unknown>(null);
  const job = useQuery({
    queryKey: ["jobs", id],
    queryFn: () => request<Job>("GET", `/api/v1/jobs/${id}`),
    refetchInterval: (q) => (q.state.data && active(q.state.data) ? POLL_MS : false),
  });
  const j = job.data;
  const name = (cluster: string) => clusters.data?.find((c) => c.id === cluster)?.name;

  return (
    <PageLayout
      title={
        <>
          <Link to="/jobs">Jobs</Link> / {j ? jobSummary(j, name) : "…"}
        </>
      }
      controls={j && canCancel(me, j) ? <CancelJobButton job={j} onError={setCancelError} /> : null}
    >
      <Loaded query={job}>
        {(j) => {
          const result = resultOf(j);
          return (
            <>
              {cancelError ? <ErrorMessage error={cancelError} title="Could not cancel the job" /> : null}
              <KeyValues
                items={[
                  ["State", <JobStateLabel state={j.state} />],
                  ["Type", <JobType job={j} />],
                  // A finished job's last stage only matters when it did not succeed: where it stopped.
                  ...(j.state === "succeeded" ? [] : [[active(j) ? "Progress" : "Stopped at", progressText(j) || UNKNOWN] as [string, ReactNode]]),
                  ["Started", j.startedAt ? new Date(j.startedAt).toLocaleString() : UNKNOWN],
                  ["Finished", j.finishedAt ? new Date(j.finishedAt).toLocaleString() : UNKNOWN],
                  ...(j.state === "failed" ? [["Error", <span className="ic-negative">{j.error || UNKNOWN}</span>] as [string, ReactNode]] : []),
                  ...(result ? [["Result", result] as [string, ReactNode]] : []),
                ]}
              />
            </>
          );
        }}
      </Loaded>
    </PageLayout>
  );
};

export default JobDetail;
