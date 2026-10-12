import { type FC, type ReactNode, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ActionButton, Button, Icon, Input, MainTable, Notification, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import Section from "../../components/Section";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import EmptyList from "../../components/EmptyList";
import { ErrorMessage, Loaded, Loading, ago } from "../../components/Status";
import { ApiError, incusAll, request } from "../../api/client";
import { useMe } from "../../api/hooks";
import type { Job, K8sCluster, K8sNode } from "../../api/types";
import K8sStatus, { busy } from "./K8sStatus";
import { canChange, canDelete, sizeLabel, useK8sOptions } from "./hooks";
import { k8sPath } from "./KubernetesList";
import { clusterOf, nameOf } from "../inventory/tree";
import { projectPath } from "../../console/object";

const POLL_MS = 5_000;
const MAX_WORKERS = 20;
const whole = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && +s >= lo && +s <= hi;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const enc = encodeURIComponent;

/** Fetches the admin kubeconfig and saves it as <name>.kubeconfig. */
async function downloadKubeconfig(k: K8sCluster) {
  const res = await fetch(`/api/v1/kubernetes/${k.id}/kubeconfig`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? `The download failed (${res.status})`);
  }
  const url = URL.createObjectURL(new Blob([await res.text()], { type: "application/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${k.name}.kubeconfig`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Its facts: what it is, where it runs, how big it is. */
const Summary: FC<{ k: K8sCluster }> = ({ k }) => {
  const options = useK8sOptions();
  const project = `${k.project}@${k.clusterName}`;
  return (
    <>
      {k.status === "error" ? (
        <Notification severity="negative" title="This cluster did not come up">
          {k.statusMessage}
        </Notification>
      ) : null}
      {k.status === "degraded" ? (
        <Notification severity="caution" title="Not fully available">
          {k.statusMessage}
        </Notification>
      ) : null}
      <Section title="General" id="k8s-general">
        <KeyValues
          items={[
            ["Status", <K8sStatus status={k.status} />],
            ["Kubernetes version", k.version],
            ["API endpoint", <code>{k.endpoint}</code>],
            ["Tenant", <Link to={`/tenants/${k.tenantId}`}>{k.tenantSlug}</Link>],
            ["Incus cluster", <Link to={`/inventory/${enc(k.clusterName)}`}>{k.clusterName}</Link>],
            ["Project", <Link to={projectPath(project, "instances")}>{k.project}</Link>],
            ...(k.member ? [["Member", <Link to={`/ui/cluster/member/${enc(`${k.member}@${k.clusterName}`)}`}>{k.member}</Link>] as [string, ReactNode]] : []),
            ["Node size", sizeLabel(options.data, k.size)],
            ["Control plane", plural(k.controlPlanes, "node")],
            ["Workers", plural(k.workers, "node")],
            ["Nodes ready", `${k.nodesReady} of ${k.controlPlanes + k.workers}`],
            ["Created", new Date(k.createdAt).toLocaleString()],
            ["Last checked", ago(k.syncedAt)],
          ]}
        />
      </Section>
    </>
  );
};

/** Its nodes: each Cluster API machine and the Incus instance (and member) it runs on. */
const Nodes: FC<{ k: K8sCluster }> = ({ k }) => {
  const project = `${k.project}@${k.clusterName}`;
  const nodes = useQuery({
    queryKey: ["kubernetes", k.id, "nodes"],
    queryFn: () => request<K8sNode[]>("GET", `/api/v1/kubernetes/${k.id}/nodes`),
    refetchInterval: busy(k) ? POLL_MS : 30_000,
  });
  const instances = useQuery({
    queryKey: ["kubernetes", k.id, "instances"],
    queryFn: () => incusAll<Array<{ name: string; location: string; status: string }>>(`/1.0/instances?project=${enc(project)}&recursion=1`),
  });
  const where = new Map((instances.data ?? []).map((i) => [i.name, i]));
  return (
    <Loaded query={nodes}>
      {(list) =>
        list.length === 0 ? (
          <EmptyList icon="kubernetes" title="No nodes yet">
            Cluster API creates the nodes once the cluster's job has applied it; they appear here as they are provisioned.
          </EmptyList>
        ) : (
          <MainTable
            headers={[{ content: "Node" }, { content: "Role" }, { content: "Phase" }, { content: "Ready" }, { content: "Version" }, { content: "Member" }, { content: "Instance status" }]}
            rows={list.map((n) => {
              const i = where.get(n.instance);
              return {
                key: n.name,
                columns: [
                  { content: n.instance ? <Link to={projectPath(project, `instance/${enc(n.instance)}`)} title={`Machine ${n.name}`}>{n.instance}</Link> : n.name },
                  { content: n.role === "control-plane" ? "Control plane" : "Worker" },
                  { content: n.phase },
                  { content: n.ready ? "Ready" : "Not ready" },
                  { content: n.version },
                  { content: i?.location ? <Link to={`/ui/cluster/member/${enc(i.location.includes("@") ? i.location : `${i.location}@${clusterOf(project)}`)}`}>{nameOf(i.location)}</Link> : "—" },
                  { content: i?.status ?? "—" },
                ],
              };
            })}
          />
        )
      }
    </Loaded>
  );
};

/** What was done to it: its jobs (create, delete), newest first. */
const Activity: FC<{ k: K8sCluster }> = ({ k }) => {
  const jobs = useQuery({
    queryKey: ["jobs", { tenant: k.tenantId }],
    queryFn: () => request<Job[]>("GET", `/api/v1/jobs?tenant=${enc(k.tenantId)}`),
    refetchInterval: busy(k) ? POLL_MS : false,
  });
  return (
    <Loaded query={jobs}>
      {(all) => {
        const mine = all.filter((j) => j.payload?.k8sId === k.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return mine.length === 0 ? (
          <p className="u-text--muted">No jobs. Scaling and upgrades are in the audit log.</p>
        ) : (
          <MainTable
            headers={[{ content: "Job" }, { content: "State" }, { content: "Stage" }, { content: "Started" }, { content: "Finished" }]}
            rows={mine.map((j) => ({
              key: j.id,
              columns: [
                { content: <Link to={`/jobs/${j.id}`}>{j.type}</Link> },
                { content: j.state },
                { content: j.error || j.progress.message || j.progress.stage },
                { content: j.startedAt ? new Date(j.startedAt).toLocaleString() : "—" },
                { content: j.finishedAt ? new Date(j.finishedAt).toLocaleString() : "—" },
              ],
            }))}
          />
        );
      }}
    </Loaded>
  );
};

/** How to reach it with kubectl. */
const Kubeconfig: FC<{ k: K8sCluster; download: () => void; downloading: boolean }> = ({ k, download, downloading }) => (
  <Section title="Kubeconfig" id="k8s-kubeconfig">
    <p>
      Cluster-admin credentials for <code>kubectl</code>. The API server <code>{k.endpoint}</code> must be reachable from where you run it.
    </p>
    <pre className="p-code-snippet__block">
      <code>{`kubectl --kubeconfig ${k.name}.kubeconfig get nodes`}</code>
    </pre>
    <ActionButton hasIcon loading={downloading} disabled={downloading} onClick={download}>
      <Icon name="begin-downloading" />
      <span>Download kubeconfig</span>
    </ActionButton>
  </Section>
);

/** One Kubernetes cluster, an inventory object in its project: its tabs, and scale, upgrade, kubeconfig, delete. */
const KubernetesDetail: FC = () => {
  const { project = "", name = "", tab = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const options = useK8sOptions();
  // Found by where it is (its project and name); then followed by id.
  const list = useQuery({ queryKey: ["kubernetes"], queryFn: () => request<K8sCluster[]>("GET", "/api/v1/kubernetes") });
  const found = list.data?.find((x) => `${x.project}@${x.clusterName}` === project && x.name === name);
  const id = found?.id ?? "";
  const cluster = useQuery({
    queryKey: ["kubernetes", id],
    queryFn: () => request<K8sCluster>("GET", `/api/v1/kubernetes/${id}`),
    enabled: !!id,
    initialData: found,
    refetchInterval: (q) => (q.state.data && busy(q.state.data) ? POLL_MS : false),
  });
  const [dialog, setDialog] = useState<"scale" | "upgrade" | null>(null);
  const [controlPlanes, setControlPlanes] = useState(1);
  const [workers, setWorkers] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);

  const k = cluster.data;
  const versions = options.data?.versions ?? [];
  const next = k ? versions[versions.indexOf(k.version) + 1] : undefined;
  const save = async (body: Record<string, unknown>) => {
    const updated = await request<K8sCluster>("PATCH", `/api/v1/kubernetes/${id}`, body);
    qc.setQueryData(["kubernetes", id], updated);
    await qc.invalidateQueries({ queryKey: ["kubernetes"], exact: true });
  };
  const download = async (c: K8sCluster) => {
    setDownloading(true);
    setError(null);
    try {
      await downloadKubeconfig(c);
    } catch (e) {
      setError(e);
    } finally {
      setDownloading(false);
    }
  };

  if (list.error) return <PageLayout title={name}>{<ErrorMessage error={list.error} />}</PageLayout>;
  if (!k) return <PageLayout title={name}>{list.isPending ? <Loading /> : <Notification severity="caution" title="Not found">No Kubernetes cluster {name} in {nameOf(project)} is available to you.</Notification>}</PageLayout>;

  return (
    <PageLayout
      title={
        <>
          {k.name} <K8sStatus status={k.status} />
        </>
      }
      controls={
        <>
          {canChange(me, k.tenantId) ? (
            <>
              <Button
                hasIcon
                disabled={busy(k)}
                onClick={() => {
                  setControlPlanes(k.controlPlanes);
                  setWorkers(String(k.workers));
                  setDialog("scale");
                }}
              >
                <Icon name="resize" />
                <span>Scale</span>
              </Button>
              {next ? (
                <Button hasIcon disabled={busy(k)} onClick={() => setDialog("upgrade")}>
                  <Icon name="upload" />
                  <span>Upgrade</span>
                </Button>
              ) : null}
              {tab !== "kubeconfig" ? (
                <ActionButton hasIcon loading={downloading} disabled={downloading} onClick={() => void download(k)}>
                  <Icon name="begin-downloading" />
                  <span>Download kubeconfig</span>
                </ActionButton>
              ) : null}
            </>
          ) : null}
          {canDelete(me, k.tenantId) && k.status !== "deleting" ? (
            <ConfirmAction
              label="Delete"
              title={`Delete ${k.name}?`}
              onConfirm={async () => {
                const job = await request<Job>("DELETE", `/api/v1/kubernetes/${id}`);
                await qc.invalidateQueries({ queryKey: ["kubernetes"] });
                navigate(`/jobs/${job.id}`);
              }}
              onError={setError}
            >
              <p>
                Its nodes and load balancer are deleted, with everything running in the cluster. Its API endpoint <code>{k.endpoint}</code> stops answering. This cannot be undone.
              </p>
            </ConfirmAction>
          ) : null}
        </>
      }
    >
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      {tab === "nodes" ? <Nodes k={k} /> : tab === "activity" ? <Activity k={k} /> : tab === "kubeconfig" ? <Kubeconfig k={k} downloading={downloading} download={() => void download(k)} /> : <Summary k={k} />}
      {dialog === "scale" ? (
        <FormModal
          title={`Scale ${k.name}`}
          submitLabel="Save"
          submitDisabled={!whole(workers, 0, MAX_WORKERS)}
          onClose={() => setDialog(null)}
          onSubmit={() => save({ controlPlanes, workers: Number(workers) })}
        >
          <Select
            id="scale-control-planes"
            label="Control plane nodes"
            value={String(controlPlanes)}
            onChange={(e) => setControlPlanes(Number(e.target.value))}
            options={[
              { value: "1", label: "1" },
              { value: "3", label: "3" },
            ]}
          />
          <Input
            id="scale-workers"
            label="Worker nodes"
            type="number"
            min={0}
            max={MAX_WORKERS}
            value={workers}
            onChange={(e) => setWorkers(e.target.value)}
            error={whole(workers, 0, MAX_WORKERS) ? undefined : `Whole number from 0 to ${MAX_WORKERS}.`}
          />
          {whole(workers, 0, MAX_WORKERS) && Number(workers) < k.workers ? (
            <Notification severity="caution" title="Scaling down">
              Cluster API drains and deletes {plural(k.workers - Number(workers), "worker node")} and their instances. Workloads move to the remaining nodes.
            </Notification>
          ) : null}
        </FormModal>
      ) : null}
      {next && dialog === "upgrade" ? (
        <FormModal title={`Upgrade ${k.name}`} submitLabel={`Upgrade to ${next}`} onClose={() => setDialog(null)} onSubmit={() => save({ version: next })}>
          <Select id="upgrade-version" label="Version" value={next} onChange={() => {}} options={[{ value: next, label: next }]} help="One minor version at a time. Nodes are replaced one by one." />
        </FormModal>
      ) : null}
    </PageLayout>
  );
};

/** Old links (`/kubernetes/<id>`): the cluster's page in its project. */
export const KubernetesRedirect: FC = () => {
  const { id = "" } = useParams();
  const k = useQuery({ queryKey: ["kubernetes", id], queryFn: () => request<K8sCluster>("GET", `/api/v1/kubernetes/${id}`) });
  if (k.isPending) return <Loading />;
  return <Navigate to={k.data ? k8sPath(k.data) : "/all/kubernetes"} replace />;
};

export default KubernetesDetail;
