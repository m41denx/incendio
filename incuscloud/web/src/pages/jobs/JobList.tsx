import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { Col, MainTable, Row, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ago, ErrorMessage, Loading } from "../../components/Status";
import { request, withQuery } from "../../api/client";
import { useMe } from "../../api/hooks";
import type { Job } from "../../api/types";
import { useClusters } from "../clusters/ClusterList";
import { useUrlParam } from "../logs/TenantScope";
import { active, canCancel, CancelJobButton, JobStateLabel, JobType, jobSummary, progressText } from "./jobState";

const LIMIT = 100;
const POLL_MS = 2_000;
const ERROR_CHARS = 80;

const STATE_OPTIONS = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];
const TYPE_OPTIONS = [
  { value: "", label: "All" },
  { value: "migrate", label: "Migration" },
  { value: "replicate", label: "Replication run" },
  { value: "failover", label: "Failover" },
];

const truncate = (s: string) => (s.length > ERROR_CHARS ? `${s.slice(0, ERROR_CHARS)}…` : s);

/** Jobs the platform runs, newest first, filtered by the URL parameters. Refetched every 2 s while a job is active. */
const JobList: FC = () => {
  const { data: me } = useMe();
  const clusters = useClusters();
  const state = useUrlParam("state");
  const type = useUrlParam("type");
  const [cancelError, setCancelError] = useState<unknown>(null);
  const name = (id: string) => clusters.data?.find((c) => c.id === id)?.name;

  const jobs = useQuery({
    queryKey: ["jobs", { state: state.value, type: type.value }],
    queryFn: () => request<Job[]>("GET", withQuery("/api/v1/jobs", { state: state.value, type: type.value, limit: LIMIT })),
    refetchInterval: (q) => (q.state.data?.some(active) ? POLL_MS : false),
  });

  return (
    <PageLayout title="Jobs">
      <Row>
        <Col size={4}>
          <Select id="jobs-state" label="State" options={STATE_OPTIONS} value={state.value} onChange={(e) => state.set(e.target.value)} />
        </Col>
        <Col size={4}>
          <Select id="jobs-type" label="Type" options={TYPE_OPTIONS} value={type.value} onChange={(e) => type.set(e.target.value)} />
        </Col>
      </Row>
      {jobs.error ? (
        <ErrorMessage error={jobs.error} />
      ) : jobs.isPending ? (
        <Loading />
      ) : (
        <>
          {cancelError ? <ErrorMessage error={cancelError} title="Could not cancel the job" /> : null}
          <MainTable
            emptyStateMsg="No jobs yet."
            headers={[{ content: "Job" }, { content: "Type" }, { content: "State" }, { content: "Progress" }, { content: "Started" }, { content: "Actions" }]}
            rows={(jobs.data ?? []).map((j) => ({
              key: j.id,
              columns: [
                { content: <Link to={`/jobs/${j.id}`}>{jobSummary(j, name)}</Link> },
                { content: <JobType job={j} /> },
                { content: <JobStateLabel state={j.state} /> },
                {
                  content: active(j) ? (
                    progressText(j)
                  ) : j.state === "failed" && j.error ? (
                    <span className="ic-negative" title={j.error}>
                      {truncate(j.error)}
                    </span>
                  ) : null,
                },
                { content: ago(j.createdAt) },
                { content: me && canCancel(me, j) ? <CancelJobButton job={j} onError={setCancelError} /> : null },
              ],
            }))}
          />
        </>
      )}
    </PageLayout>
  );
};

export default JobList;
