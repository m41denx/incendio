import { type FC, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckboxInput, Input, Notification, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { Backup, Job, TenantPlacement } from "../../api/types";
import { useClusters } from "../clusters/ClusterList";

/** Where the caller may restore: any cluster for operators, the tenant's ready placements otherwise (its own cluster included). */
function useTargets(backup: Backup, operator: boolean) {
  const clusters = useClusters();
  const placements = useQuery({
    queryKey: ["tenants", backup.tenantId, "placements"],
    queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${backup.tenantId}/placements`),
    enabled: !operator && !!backup.tenantId,
  });
  if (operator) return (clusters.data ?? []).map((c) => ({ id: c.id, name: c.name }));
  return (placements.data ?? []).filter((p) => p.status === "ready").map((p) => ({ id: p.clusterId, name: p.clusterName }));
}

/**
 * Restoring a backup: a cluster, a name (never an existing instance's), and
 * whether to start it; platform operators may also pick the project and pool.
 * The job page follows it.
 */
const RestoreBackup: FC<{ backup: Backup; onClose: () => void }> = ({ backup, onClose }) => {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const operator = can(me, "operator");
  const targets = useTargets(backup, operator);
  const [cluster, setCluster] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [project, setProject] = useState("");
  const [pool, setPool] = useState("");
  const [start, setStart] = useState(false);

  useEffect(() => {
    if (cluster || !targets.length) return;
    // The backup's own cluster first when it is a choice.
    setCluster((targets.find((t) => t.id === backup.clusterId) ?? targets[0])!.id);
  }, [cluster, targets, backup.clusterId]);
  // Next to the original, the original's name is taken: suggest another, until the user types one.
  useEffect(() => {
    if (!nameTouched && cluster) setName(cluster === backup.clusterId ? `${backup.instanceName}-restored` : backup.instanceName);
  }, [cluster, nameTouched, backup.clusterId, backup.instanceName]);

  const submit = async () => {
    const job = await request<Job>("POST", `/api/v1/backups/${backup.id}/restore`, {
      targetClusterId: cluster,
      targetName: name,
      ...(operator && project && { targetProject: project }),
      ...(operator && pool && { pool }),
      start,
    });
    navigate(`/jobs/${job.id}`);
  };

  return (
    <FormModal title={`Restore ${backup.instanceName}`} submitLabel="Restore" onSubmit={submit} onClose={onClose} submitDisabled={!cluster || !name}>
      {targets.length === 0 ? (
        <Notification severity="information" title="Nowhere to restore to">
          {operator ? "There is no cluster." : "The tenant is not ready on any cluster."}
        </Notification>
      ) : null}
      <Select id="restore-cluster" label="Cluster" value={cluster} options={targets.map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => setCluster(e.target.value)} />
      <Input
        id="restore-name"
        type="text"
        label="Name"
        help="An existing instance is never replaced."
        value={name}
        onChange={(e) => {
          setNameTouched(true);
          setName(e.target.value);
        }}
      />
      {operator ? (
        <>
          <Input id="restore-project" type="text" label="Project" help="Empty: the tenant's project on that cluster, else the backup's project." value={project} onChange={(e) => setProject(e.target.value)} />
          <Input id="restore-pool" type="text" label="Storage pool" help="Empty: the project's default profile decides." value={pool} onChange={(e) => setPool(e.target.value)} />
        </>
      ) : null}
      <CheckboxInput label="Start it afterwards" checked={start} onChange={() => setStart(!start)} />
    </FormModal>
  );
};

export default RestoreBackup;
