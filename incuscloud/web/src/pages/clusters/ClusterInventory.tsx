import type { FC } from "react";
import { MainTable, Notification } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import Meter from "../../components/Meter";
import { Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import type { ClusterInventory as Inventory } from "../../api/types";
import { UNKNOWN } from "../../lib/format";

/** Members and storage pools as the server last read them; for platform viewers. */
const ClusterInventory: FC<{ clusterId: string }> = ({ clusterId }) => {
  const inventory = useQuery({
    queryKey: ["clusters", clusterId, "inventory"],
    queryFn: () => request<Inventory>("GET", `/api/v1/clusters/${clusterId}/inventory`),
  });

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
            <p className="ic-muted">Inventory read {ago(inv.inventoryAt)}</p>
            <MainTable
              emptyStateMsg="No members reported."
              headers={[{ content: "Name" }, { content: "Status" }, { content: "Roles" }, { content: "CPU threads" }, { content: "Memory" }, { content: "Load" }]}
              rows={inv.members.map((m) => ({
                key: m.name,
                columns: [
                  { content: m.name },
                  { content: m.status },
                  { content: m.roles.length ? m.roles.join(", ") : UNKNOWN },
                  { content: m.cpuThreads },
                  { content: <Meter used={m.memoryUsed} total={m.memoryTotal} label={`${m.name} memory`} /> },
                  { content: m.load1 == null ? UNKNOWN : m.load1.toFixed(2) },
                ],
              }))}
            />
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
