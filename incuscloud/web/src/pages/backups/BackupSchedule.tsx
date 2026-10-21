import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckboxInput, Input, Notification, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loading } from "../../components/Status";
import { request } from "../../api/client";
import type { BackupPolicy, BackupTarget, Instance } from "../../api/types";

const EVERY = [
  { value: "21600", label: "6 hours" },
  { value: "43200", label: "12 hours" },
  { value: "86400", label: "Day" },
  { value: "604800", label: "Week" },
];

/** Back the instance up on a schedule to an S3 target, keeping the newest backups. */
const BackupSchedule: FC<{ instance: Instance; onClose: () => void }> = ({ instance, onClose }) => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const targetsQuery = useQuery({ queryKey: ["backup-targets"], queryFn: () => request<BackupTarget[]>("GET", "/api/v1/backup-targets") });
  // Staff also see disabled targets; they cannot be used.
  const targets = (targetsQuery.data ?? []).filter((t) => t.enabled !== false);
  const [chosen, setChosen] = useState("");
  const target = targets.some((t) => t.id === chosen) ? chosen : (targets[0]?.id ?? "");
  const [every, setEvery] = useState("86400");
  const [keep, setKeep] = useState("7");
  const [instanceOnly, setInstanceOnly] = useState(false);

  return (
    <FormModal
      title={`Schedule backups of ${instance.name}`}
      submitLabel="Create schedule"
      submitDisabled={targetsQuery.isPending || !!targetsQuery.error || !target}
      onClose={onClose}
      onSubmit={async () => {
        // A disabled ActionButton is only aria-disabled, so a submit (Enter in a field) can still arrive.
        if (!target) throw new Error("Choose a backup target.");
        const keepN = Number(keep);
        if (!Number.isInteger(keepN) || keepN < 1 || keepN > 365) throw new Error("Keep must be a whole number from 1 to 365.");
        await request<BackupPolicy>("POST", "/api/v1/backup-policies", {
          instanceId: instance.id,
          targetId: target,
          intervalS: Number(every),
          keep: keepN,
          instanceOnly,
        });
        await qc.invalidateQueries({ queryKey: ["backup-policies"] });
        navigate(`/backups?instance=${instance.id}`);
      }}
    >
      {targetsQuery.error ? <ErrorMessage error={targetsQuery.error} /> : null}
      {targetsQuery.isPending ? <Loading /> : null}
      {!targetsQuery.isPending && !targetsQuery.error && !targets.length ? (
        <Notification severity="caution">No backup target is set up yet. Platform admins add them under Backup targets.</Notification>
      ) : null}
      <Select
        id="schedule-target"
        label="Target"
        required
        value={target}
        onChange={(e) => setChosen(e.target.value)}
        options={targets.map((t) => ({ value: t.id, label: t.name }))}
      />
      <Select id="schedule-every" label="Every" options={EVERY} value={every} onChange={(e) => setEvery(e.target.value)} />
      <Input
        id="schedule-keep"
        type="number"
        label="Keep"
        min={1}
        max={365}
        value={keep}
        help="The newest backups kept; older ones are deleted"
        onChange={(e) => setKeep(e.target.value)}
      />
      <CheckboxInput label="Without snapshots" checked={instanceOnly} onChange={() => setInstanceOnly(!instanceOnly)} />
    </FormModal>
  );
};

export default BackupSchedule;
