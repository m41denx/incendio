import { type FC, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActionButton, Button, Icon, Input, Notification, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import Section from "../../components/Section";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { ApiError, request } from "../../api/client";
import { useMe } from "../../api/hooks";
import type { Job, K8sCluster } from "../../api/types";
import K8sStatus, { busy } from "./K8sStatus";
import { canChange, canDelete, sizeLabel, useK8sOptions } from "./hooks";

const POLL_MS = 5_000;
const MAX_WORKERS = 20;
const whole = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && +s >= lo && +s <= hi;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

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

/** One Kubernetes cluster: what it is, how to reach it, and scale, upgrade, delete. */
const KubernetesDetail: FC = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const options = useK8sOptions();
  const cluster = useQuery({
    queryKey: ["kubernetes", id],
    queryFn: () => request<K8sCluster>("GET", `/api/v1/kubernetes/${id}`),
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

  return (
    <PageLayout
      title={
        <>
          <Link to="/kubernetes">Kubernetes clusters</Link> / {k?.name ?? "…"}
        </>
      }
      controls={
        k && canChange(me, k.tenantId) ? (
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
        ) : undefined
      }
    >
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      <Loaded query={cluster}>
        {(c) => (
          <>
            {c.status === "error" ? (
              <Notification severity="negative" title="This cluster did not come up">
                {c.statusMessage}
              </Notification>
            ) : null}
            {c.status === "degraded" ? (
              <Notification severity="caution" title="Not fully available">
                {c.statusMessage}
              </Notification>
            ) : null}
            <Section title="General" id="k8s-general">
              <KeyValues
                items={[
                  ["Status", <K8sStatus status={c.status} />],
                  ["Kubernetes version", c.version],
                  ["API endpoint", <code>{c.endpoint}</code>],
                  ["Tenant", <Link to={`/tenants/${c.tenantId}`}>{c.tenantSlug}</Link>],
                  ["Incus cluster", <Link to={`/clusters/${c.clusterId}`}>{c.clusterName}</Link>],
                  ["Node size", sizeLabel(options.data, c.size)],
                  ["Control plane", plural(c.controlPlanes, "node")],
                  ["Workers", plural(c.workers, "node")],
                  ["Nodes ready", `${c.nodesReady} of ${c.controlPlanes + c.workers}`],
                  ["Created", new Date(c.createdAt).toLocaleString()],
                  ["Last checked", ago(c.syncedAt)],
                ]}
              />
            </Section>
            <Section title="Kubeconfig" id="k8s-kubeconfig">
              <p className="u-text--muted">
                Cluster-admin credentials for <code>kubectl</code>. The API server <code>{c.endpoint}</code> must be reachable from where you run it.
              </p>
              <ActionButton hasIcon loading={downloading} disabled={downloading} onClick={() => void download(c)}>
                <Icon name="begin-downloading" />
                <span>Download kubeconfig</span>
              </ActionButton>
            </Section>
          </>
        )}
      </Loaded>
      {k && dialog === "scale" ? (
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
      {k && next && dialog === "upgrade" ? (
        <FormModal title={`Upgrade ${k.name}`} submitLabel={`Upgrade to ${next}`} onClose={() => setDialog(null)} onSubmit={() => save({ version: next })}>
          <Select id="upgrade-version" label="Version" value={next} onChange={() => {}} options={[{ value: next, label: next }]} help="One minor version at a time. Nodes are replaced one by one." />
        </FormModal>
      ) : null}
    </PageLayout>
  );
};

export default KubernetesDetail;
