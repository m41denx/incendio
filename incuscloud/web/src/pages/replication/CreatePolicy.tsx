import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Notification, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loading } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { Instance, ReplicationPolicy, TenantPlacement } from "../../api/types";
import { useClusters } from "../clusters/ClusterList";

const EVERY = [
  { value: "300", label: "5 min" },
  { value: "900", label: "15 min" },
  { value: "3600", label: "1 hour" },
  { value: "21600", label: "6 hours" },
  { value: "86400", label: "1 day" },
];

/** Replicate an instance to another cluster: a policy, then the list of policies. */
const CreatePolicy: FC<{ instance: Instance; onClose: () => void }> = ({ instance, onClose }) => {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const operator = can(me, "operator");
  // Operators pick any other cluster; tenant owners and admins pick among the tenant's placements.
  const clusters = useClusters();
  const placements = useQuery({
    queryKey: ["tenants", instance.tenantId, "placements"],
    queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${instance.tenantId}/placements`),
    enabled: !operator && !!instance.tenantId,
  });
  const [target, setTarget] = useState("");
  const [name, setName] = useState(instance.name);
  const [every, setEvery] = useState("3600");

  const failed = operator ? clusters.error : placements.error;
  const loading = operator ? clusters.isPending : !!instance.tenantId && placements.isPending;
  const targets: Array<{ id: string; name: string }> = operator
    ? (clusters.data ?? []).filter((c) => c.id !== instance.clusterId).map((c) => ({ id: c.id, name: c.name }))
    : (placements.data ?? []).filter((p) => p.status === "ready" && p.clusterId !== instance.clusterId).map((p) => ({ id: p.clusterId, name: p.clusterName }));

  return (
    <FormModal
      title={`Replicate ${instance.name}`}
      submitLabel="Create policy"
      submitDisabled={loading || !target || !targets.length}
      onClose={onClose}
      onSubmit={async () => {
        // A disabled ActionButton is only aria-disabled, so a submit (Enter in a field) can still arrive.
        if (!target) throw new Error("Choose a cluster to replicate to.");
        await request<ReplicationPolicy>("POST", "/api/v1/replication-policies", {
          instanceId: instance.id,
          targetClusterId: target,
          targetName: name.trim() || undefined,
          intervalS: Number(every),
        });
        await qc.invalidateQueries({ queryKey: ["replication-policies"] });
        navigate("/replication");
      }}
    >
      {failed ? <ErrorMessage error={failed} /> : null}
      {loading ? <Loading /> : null}
      {!loading && !failed && !targets.length ? (
        <Notification severity="caution">No other cluster to replicate to: the tenant must be placed on another cluster.</Notification>
      ) : null}
      <Select
        id="replica-cluster"
        label="Target cluster"
        required
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        options={[{ value: "", label: "Choose a cluster", disabled: true }, ...targets.map((t) => ({ value: t.id, label: t.name }))]}
      />
      <Input id="replica-name" type="text" label="Replica name" value={name} onChange={(e) => setName(e.target.value)} />
      <Select id="replica-every" label="Every" options={EVERY} value={every} onChange={(e) => setEvery(e.target.value)} />
    </FormModal>
  );
};

export default CreatePolicy;
