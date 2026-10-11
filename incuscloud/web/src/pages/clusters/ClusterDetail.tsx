import { type FC, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActionButton, Textarea } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import KeyValues from "../../components/KeyValues";
import ConfirmAction from "../../components/ConfirmAction";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { ApiError, request } from "../../api/client";
import { can, clusterApiUrl, useMe } from "../../api/hooks";
import type { Cluster } from "../../api/types";
import ClusterStatus from "./ClusterStatus";
import PlacedTenants from "./PlacedTenants";
import ClusterInventory from "./ClusterInventory";
import ClusterBalancing from "./ClusterBalancing";
import { formatLabels, parseLabels } from "./labels";

const ClusterDetail: FC = () => {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cluster = useQuery({
    queryKey: ["clusters", id],
    queryFn: () => request<Cluster>("GET", `/api/v1/clusters/${id}`),
    // Follow a requested reconcile until it has run.
    refetchInterval: (q) => (q.state.data?.reconcileRequestedAt ? 2000 : false),
  });
  const [error, setError] = useState<unknown>(null);
  const [needsForce, setNeedsForce] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [editingLabels, setEditingLabels] = useState(false);
  const [labels, setLabels] = useState("");
  const operator = can(me, "operator");
  const viewer = can(me, "viewer");
  const admin = can(me, "admin");

  const reconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      await request("POST", `/api/v1/clusters/${id}/reconcile`);
      await qc.invalidateQueries({ queryKey: ["clusters", id] });
    } catch (e) {
      setError(e);
    } finally {
      setReconciling(false);
    }
  };
  const remove = async (force: boolean) => {
    try {
      await request("DELETE", `/api/v1/clusters/${id}${force ? "?force=true" : ""}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "cluster_in_use") setNeedsForce(true);
      throw e;
    }
    await qc.invalidateQueries({ queryKey: ["clusters"] });
    navigate("/clusters");
  };

  return (
    <PageLayout
      title={
        <>
          <Link to="/clusters">Clusters</Link> / {cluster.data?.name ?? "…"}
        </>
      }
      controls={
        cluster.data ? (
          <>
            <a className="p-button" href={`/clusters/${cluster.data.name}/ui/`}>
              Open console
            </a>
            {operator ? (
              <ActionButton loading={reconciling} disabled={reconciling} onClick={reconcile}>
                Reconcile now
              </ActionButton>
            ) : null}
          </>
        ) : undefined
      }
    >
      {error ? <ErrorMessage error={error} title="Not done" /> : null}
      <Loaded query={cluster}>
        {(c) => (
          <>
            <KeyValues
              items={[
                ["Status", <><ClusterStatus status={c.status} />{c.statusMessage ? <span className="ic-muted"> {c.statusMessage}</span> : null}</>],
                ["Address", <span className="ic-mono">{c.url}</span>],
                ["Certificate", <span className="ic-mono" title={c.fingerprint}>{c.fingerprint.slice(0, 16)}…</span>],
                ["Last seen", ago(c.lastSeenAt)],
                ["Reconciled", <>{ago(c.reconciledAt)}{c.reconcileRequestedAt ? <span className="ic-muted"> · a new pass is requested</span> : null}</>],
                ["Labels", Object.keys(c.labels).length ? Object.entries(c.labels).map(([k, v]) => `${k}=${v}`).join(", ") : "—"],
              ]}
            />
            <h2 className="p-heading--4">Command line</h2>
            <p>Add this cluster to the incus CLI (or any Incus API client); it signs in through IncusCloud:</p>
            <pre className="ic-mono">{`incus remote add ${c.name} ${clusterApiUrl(me, c.name)} --auth-type=oidc`}</pre>
            <PlacedTenants cluster={c} canManage={operator} />
            {viewer ? <ClusterInventory clusterId={c.id} canManage={operator} /> : null}
            {viewer ? <ClusterBalancing clusterId={c.id} canManage={operator} /> : null}
            {admin ? (
              <>
                <h2 className="p-heading--4">Administration</h2>
                <div className="ic-page-controls">
                  <ActionButton
                    onClick={() => {
                      setLabels(formatLabels(c.labels));
                      setEditingLabels(true);
                    }}
                  >
                    Edit labels
                  </ActionButton>
                  <ConfirmAction label="Delete" title={`Delete ${c.name}?`} onConfirm={() => remove(false)} onError={setError}>
                    <p>IncusCloud stops managing this cluster: the cluster stops accepting IncusCloud sign-ins and IncusCloud's certificate is removed from it. Instances and projects on the cluster are not touched.</p>
                  </ConfirmAction>
                  {needsForce ? (
                    <ConfirmAction label="Delete anyway" title={`Delete ${c.name} with its tenants?`} onConfirm={() => remove(true)} onError={setError}>
                      <p>The tenants placed on it lose access to it. Their projects and instances stay on the cluster.</p>
                    </ConfirmAction>
                  ) : null}
                </div>
              </>
            ) : null}
            {editingLabels ? (
              <FormModal
                title="Edit labels"
                submitLabel="Save"
                onClose={() => setEditingLabels(false)}
                onSubmit={async () => {
                  const updated = await request<Cluster>("PATCH", `/api/v1/clusters/${id}`, { labels: parseLabels(labels) });
                  qc.setQueryData(["clusters", id], updated);
                  await qc.invalidateQueries({ queryKey: ["clusters"], exact: true });
                }}
              >
                <Textarea id="edit-labels" label="Labels" rows={4} value={labels} onChange={(e) => setLabels(e.target.value)} help="key=value per line." />
              </FormModal>
            ) : null}
          </>
        )}
      </Loaded>
    </PageLayout>
  );
};

export default ClusterDetail;
