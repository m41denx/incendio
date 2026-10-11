import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, MainTable, Notification } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import ConfirmAction from "../../components/ConfirmAction";
import Meter from "../../components/Meter";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import type { ClusterInventory as Inventory, ClusterMember, Job } from "../../api/types";
import { UNKNOWN } from "../../lib/format";
import EvacuateMember from "./EvacuateMember";

/** Members and storage pools as the server last read them; for platform viewers. `canManage` adds maintenance actions for members. */
const ClusterInventory: FC<{ clusterId: string; canManage?: boolean }> = ({ clusterId, canManage = false }) => {
  const navigate = useNavigate();
  const [evacuating, setEvacuating] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inventory = useQuery({
    queryKey: ["clusters", clusterId, "inventory"],
    queryFn: () => request<Inventory>("GET", `/api/v1/clusters/${clusterId}/inventory`),
  });

  const restore = async (name: string) => {
    setError(null);
    const job = await request<Job>("POST", `/api/v1/clusters/${clusterId}/members/${encodeURIComponent(name)}/restore`);
    navigate(`/jobs/${job.id}`);
  };

  const actions = (m: ClusterMember) => {
    if (m.status === "Online")
      return (
        <Button type="button" className="is-small u-no-margin--bottom" onClick={() => setEvacuating(m.name)}>
          Evacuate…
        </Button>
      );
    if (m.status === "Evacuated")
      return (
        <ConfirmAction
          label="Restore"
          appearance="positive"
          className="is-small u-no-margin--bottom"
          title={`Restore ${m.name}?`}
          onError={setError}
          onConfirm={() => restore(m.name)}
        >
          <p>Instances that left it come back, and it takes new ones again.</p>
        </ConfirmAction>
      );
    return null;
  };

  return (
    <section aria-labelledby="cluster-inventory">
      <h2 id="cluster-inventory" className="p-heading--4">
        Members and storage
      </h2>
      <Loaded query={inventory}>
        {(inv) => (
          <>
            {inv.inventoryError ? (
              <Notification severity="caution" title="Inventory failed">
                {inv.inventoryError}
              </Notification>
            ) : null}
            {error ? <ErrorMessage error={error} /> : null}
            <p className="ic-muted">Inventory read {ago(inv.inventoryAt)}</p>
            <MainTable
              emptyStateMsg="No members reported."
              headers={[
                { content: "Name" },
                { content: "Status" },
                { content: "Roles" },
                { content: "CPU threads" },
                { content: "Memory" },
                { content: "Load" },
                ...(canManage ? [{ content: "", className: "u-align--right ic-col-actions" }] : []),
              ]}
              rows={inv.members.map((m) => ({
                key: m.name,
                columns: [
                  { content: m.name },
                  { content: m.status },
                  { content: m.roles.length ? m.roles.join(", ") : UNKNOWN },
                  { content: m.cpuThreads },
                  { content: <Meter used={m.memoryUsed} total={m.memoryTotal} label={`${m.name} memory`} /> },
                  { content: m.load1 == null ? UNKNOWN : m.load1.toFixed(2) },
                  ...(canManage ? [{ className: "u-align--right ic-col-actions", content: actions(m) }] : []),
                ],
              }))}
            />
            {evacuating ? <EvacuateMember clusterId={clusterId} member={evacuating} onClose={() => setEvacuating(null)} /> : null}
            <MainTable
              emptyStateMsg="No storage pools reported."
              headers={[{ content: "Pool" }, { content: "Member" }, { content: "Driver" }, { content: "Space" }]}
              rows={inv.pools.map((p) => ({
                key: `${p.member}/${p.name}`,
                columns: [
                  { content: p.name },
                  { content: p.member },
                  { content: p.driver },
                  { content: <Meter used={p.spaceUsed} total={p.spaceTotal} label={`${p.member}/${p.name} space`} /> },
                ],
              }))}
            />
            <p className="ic-muted">{`${inv.instances.total} instances, ${inv.instances.running} running`}</p>
          </>
        )}
      </Loaded>
    </section>
  );
};

export default ClusterInventory;
