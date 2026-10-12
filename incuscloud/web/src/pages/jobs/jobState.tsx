import type { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ConfirmAction from "../../components/ConfirmAction";
import { request } from "../../api/client";
import { can, tenantRole } from "../../api/hooks";
import type { Job, JobState, Me } from "../../api/types";
import { UNKNOWN, bytes } from "../../lib/format";

const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const TYPE_LABELS: Record<string, string> = { migrate: "Migration", replicate: "Replication run", failover: "Failover", backup: "Backup", restore: "Restore", create: "Create", rebalance: "Rebalance", evacuate: "Member maintenance", "restore-member": "Member maintenance" };
/** Pages that list what a job type works on. */
const TYPE_PAGES: Record<string, string> = { create: "/instances", replicate: "/replication", failover: "/replication", backup: "/backups", restore: "/backups" };
/** Job types about one cluster: they link to its page. */
const CLUSTER_TYPES = new Set(["rebalance", "evacuate", "restore-member"]);
export const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

const VARIANT: Record<JobState, string> = { queued: "information", running: "information", succeeded: "positive", failed: "negative", cancelled: "" };

/** A job's state as a status label. */
export const JobStateLabel: FC<{ state: JobState }> = ({ state }) => {
  const variant = VARIANT[state];
  return <span className={variant ? `p-status-label--${variant}` : "p-status-label"}>{cap(state)}</span>;
};

/** Queued or running: the job is still doing work. */
export const active = (job: Job) => job.state === "queued" || job.state === "running";

/** The job's type; replication runs and failovers link to the replication policies. */
export const JobType: FC<{ job: Job }> = ({ job }) => {
  const label = typeLabel(job.type);
  const cluster = job.payload.clusterId;
  const page = CLUSTER_TYPES.has(job.type) && typeof cluster === "string" ? `/clusters/${cluster}` : TYPE_PAGES[job.type];
  return page ? <Link to={page}>{label}</Link> : <>{label}</>;
};

/**
 * One line for a job. A migration reads "Move acme/web (edge-1) → acme/web (edge-2)";
 * `clusterName` gives a cluster's name, and an unknown cluster shows its short id.
 */
export function jobSummary(job: Job, clusterName: (id: string) => string | undefined = () => undefined): string {
  const p = job.payload;
  const place = (cluster: unknown, project: unknown, name: unknown) => {
    const id = str(cluster);
    return `${str(project)}/${str(name)} (${clusterName(id) ?? shortId(id)})`;
  };
  if (job.type === "backup") return `Back up ${place(p.clusterId, p.project, p.instanceName)}`;
  if (job.type === "restore") return `Restore to ${place(p.targetClusterId, p.targetProject, p.targetName)}`;
  const cluster = (id: unknown) => clusterName(str(id)) ?? shortId(str(id));
  if (job.type === "create") return `Create ${place(p.clusterId, p.project, p.name)}`;
  if (job.type === "rebalance") return `Rebalance ${cluster(p.clusterId)}`;
  if (job.type === "evacuate") return `Evacuate ${str(p.member)} (${cluster(p.clusterId)})`;
  if (job.type === "restore-member") return `Restore ${str(p.member)} (${cluster(p.clusterId)})`;
  if (job.type !== "migrate") return typeLabel(job.type);
  const verb = cap(str(p.mode)) || "Migrate";
  return `${verb} ${place(p.sourceClusterId, p.sourceProject, p.name)} → ${place(p.targetClusterId, p.targetProject, p.targetName)}`;
}

/** The stage, and the message when there is one. */
export const progressText = (job: Job) => [job.progress.stage, job.progress.message].filter(Boolean).join(" — ");

/** Whether the caller may cancel this job: it is still active, and they started it, run the platform, or own or administer its tenant. */
export function canCancel(me: Me | undefined, job: Job): boolean {
  if (!me || !active(job)) return false;
  if (job.actorType === "user" && job.actorId === me.id) return true;
  if (can(me, "operator")) return true;
  return job.tenantId !== null && ["owner", "admin"].includes(tenantRole(me, job.tenantId) ?? "");
}

/** Asks the server to cancel a job; the job queries are refetched afterwards. */
export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<Job>("POST", `/api/v1/jobs/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** A Cancel button that asks first. Failures go to `onError`. */
export const CancelJobButton: FC<{ job: Job; onError: (e: unknown) => void }> = ({ job, onError }) => {
  const cancel = useCancelJob();
  return (
    <ConfirmAction
      appearance="base"
      label="Cancel"
      title="Cancel this job?"
      onError={onError}
      onConfirm={() => {
        onError(null);
        return cancel.mutateAsync(job.id);
      }}
    >
      <p>The job stops at its next step. A migration removes the copy it was making and restarts the source if it stopped it; once a move has started deleting the source, it finishes.</p>
    </ConfirmAction>
  );
};

/** What a finished job produced, if anything: a migration's target, or a failover's warnings. */
export function resultOf(job: Job): ReactNode | null {
  const r = job.result;
  if (!r) return null;
  if (job.type === "migrate") {
    return (
      <>
        <div>{`Target: ${str(r.targetProject)}/${str(r.targetName)}`}</div>
        <div>{`Transport: ${str(r.transport)}`}</div>
      </>
    );
  }
  if (job.type === "create") {
    const p = job.payload;
    const cpu = Number(p.cpu);
    return <div>{`${str(p.image)}, ${cpu} CPU${cpu === 1 ? "" : "s"}, ${bytes(Number(p.memory))} memory, ${(Number(p.disk) / 1024 ** 3).toFixed(0)} GiB disk`}</div>;
  }
  if (job.type === "rebalance") {
    const n = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : UNKNOWN);
    const moves = Array.isArray(r.moves) ? (r.moves as Array<Record<string, unknown>>) : [];
    const notes = Array.isArray(r.notes) ? r.notes.map(String) : [];
    return (
      <>
        <div>{`Spread ${n(r.before)} → ${n(r.after)} points`}</div>
        {moves.length ? null : <div>Nothing to move</div>}
        {moves.map((m) => (
          <div key={`${str(m.project)}/${str(m.name)}`}>{`${str(m.project)}/${str(m.name)}: ${str(m.from)} → ${str(m.to)}, ${str(m.outcome)}${m.detail ? ` (${str(m.detail)})` : ""}`}</div>
        ))}
        {notes.map((x) => (
          <div key={x} className="u-text--muted">
            {x}
          </div>
        ))}
      </>
    );
  }
  if (job.type === "restore") return <div>{`Restored as ${str(r.targetProject)}/${str(r.targetName)}`}</div>;
  const warnings = Array.isArray(r.warnings) ? r.warnings.map(String) : [];
  if (job.type === "backup") {
    const pruned = typeof r.pruned === "number" ? r.pruned : 0;
    return (
      <>
        <div>{`${typeof r.sizeBytes === "number" ? bytes(r.sizeBytes) : UNKNOWN}, ${r.transport === "direct" ? "uploaded by the cluster" : "through the control plane"}`}</div>
        {pruned ? <div>{`${pruned} older backup${pruned === 1 ? "" : "s"} deleted`}</div> : null}
        {warnings.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </>
    );
  }
  return warnings.length ? warnings.map((w) => <div key={w}>{w}</div>) : null;
}
