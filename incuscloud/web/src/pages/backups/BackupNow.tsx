import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckboxInput, Notification, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loading } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { BackupTarget, Instance, Job } from "../../api/types";

type Transport = "auto" | "direct" | "relay";

/** Back the instance up to an S3 target now; the job page follows it. */
const BackupNow: FC<{ instance: Instance; onClose: () => void }> = ({ instance, onClose }) => {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const operator = can(me, "operator");
  const targetsQuery = useQuery({ queryKey: ["backup-targets"], queryFn: () => request<BackupTarget[]>("GET", "/api/v1/backup-targets") });
  // Staff also see disabled targets; they cannot be used.
  const targets = (targetsQuery.data ?? []).filter((t) => t.enabled !== false);
  const [chosen, setChosen] = useState("");
  const target = targets.some((t) => t.id === chosen) ? chosen : (targets[0]?.id ?? "");
  const [instanceOnly, setInstanceOnly] = useState(false);
  const [transport, setTransport] = useState<Transport>("auto");

  return (
    <FormModal
      title={`Back up ${instance.name}`}
      submitLabel="Back up"
      submitDisabled={targetsQuery.isPending || !!targetsQuery.error || !target}
      onClose={onClose}
      onSubmit={async () => {
        // A disabled ActionButton is only aria-disabled, so a submit (Enter in a field) can still arrive.
        if (!target) throw new Error("Choose a backup target.");
        const job = await request<Job>("POST", `/api/v1/instances/${instance.id}/backups`, {
          targetId: target,
          instanceOnly,
          ...(operator && transport !== "auto" ? { transport } : {}),
        });
        navigate(`/jobs/${job.id}`);
      }}
    >
      {targetsQuery.error ? <ErrorMessage error={targetsQuery.error} /> : null}
      {targetsQuery.isPending ? <Loading /> : null}
      {!targetsQuery.isPending && !targetsQuery.error && !targets.length ? (
        <Notification severity="caution">No backup target is set up yet. Platform admins add them under Backup targets.</Notification>
      ) : null}
      <Select
        id="backup-now-target"
        label="Target"
        required
        value={target}
        onChange={(e) => setChosen(e.target.value)}
        options={targets.map((t) => ({ value: t.id, label: t.name }))}
      />
      <CheckboxInput label="Without snapshots" checked={instanceOnly} onChange={() => setInstanceOnly(!instanceOnly)} />
      {operator ? (
        <Select
          id="backup-now-transport"
          label="Transport"
          value={transport}
          onChange={(e) => setTransport(e.target.value as Transport)}
          options={[
            { value: "auto", label: "Automatic" },
            { value: "direct", label: "Uploaded by the cluster" },
            { value: "relay", label: "Through the control plane" },
          ]}
        />
      ) : null}
    </FormModal>
  );
};

export default BackupNow;
