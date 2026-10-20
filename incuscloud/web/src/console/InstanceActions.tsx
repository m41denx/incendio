import { type FC, useState } from "react";
import { ContextualMenu } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request, withQuery } from "../api/client";
import type { Instance } from "../api/types";
import { useClusters } from "../pages/clusters/ClusterList";
import { nameOf } from "../pages/inventory/tree";
import MigrateInstance from "../pages/instances/MigrateInstance";
import CreatePolicy from "../pages/replication/CreatePolicy";
import BackupNow from "../pages/backups/BackupNow";
import BackupSchedule from "../pages/backups/BackupSchedule";
import BalancingRules from "../pages/instances/BalancingRules";

type Dialog = "migrate" | "replicate" | "backup" | "schedule" | "rules";

/** Each action, the privilege on the instance it needs (what the API checks), and its dialog. */
const ACTIONS: Array<{ id: Dialog; label: string; needs: string }> = [
  { id: "migrate", label: "Move or copy to another cluster…", needs: "instance.relocate" },
  { id: "replicate", label: "Replicate…", needs: "replication.manage" },
  { id: "backup", label: "Back up now…", needs: "backup.create" },
  { id: "schedule", label: "Backup schedule…", needs: "backup.schedule" },
  { id: "rules", label: "Balancing rules…", needs: "instance.configure" },
];

/** The platform's record of an instance the console shows by cluster, project and name. */
export function usePlatformInstance(cluster: string, project: string, name: string) {
  const clusters = useClusters();
  const clusterId = clusters.data?.find((c) => c.name === cluster)?.id;
  return useQuery({
    queryKey: ["instances", "by-name", cluster, project, name],
    enabled: !!clusterId,
    queryFn: async () => {
      const { items } = await request<{ items: Instance[] }>("GET", withQuery("/api/v1/instances", { cluster: clusterId, q: name, limit: 50 }));
      const row = items.find((i) => i.project === project && i.name === name);
      // Not in the inventory yet (just created): no actions until the next inventory pass.
      return row ? request<Instance>("GET", `/api/v1/instances/${row.id}`) : null;
    },
    staleTime: 30_000,
  });
}

/**
 * IncusCloud's own actions on an instance, next to the breadcrumb above Incendio's instance page:
 * moving it to another cluster, replication, backups and balancing rules. Only the ones the caller
 * may use show; none at all, nothing shows.
 */
const InstanceActions: FC<{ cluster: string; project: string; name: string }> = ({ cluster, project, name }) => {
  const instance = usePlatformInstance(cluster, nameOf(project), name);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const i = instance.data;
  if (!i) return null;
  const allowed = ACTIONS.filter((a) => i.privileges?.includes(a.needs));
  if (!allowed.length) return null;
  const close = () => setDialog(null);
  return (
    <>
      <ContextualMenu
        className="ic-object__actions"
        hasToggleIcon
        position="right"
        toggleLabel="IncusCloud"
        toggleClassName="u-no-margin--bottom"
        links={allowed.map((a) => ({ children: a.label, onClick: () => setDialog(a.id) }))}
      />
      {dialog === "migrate" ? <MigrateInstance instance={i} onClose={close} /> : null}
      {dialog === "replicate" ? <CreatePolicy instance={i} onClose={close} /> : null}
      {dialog === "backup" ? <BackupNow instance={i} onClose={close} /> : null}
      {dialog === "schedule" ? <BackupSchedule instance={i} onClose={close} /> : null}
      {dialog === "rules" ? <BalancingRules instance={i} onClose={close} /> : null}
    </>
  );
};

export default InstanceActions;
