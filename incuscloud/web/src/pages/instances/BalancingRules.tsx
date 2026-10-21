import { type FC, useState } from "react";
import { CheckboxInput, Input, Notification } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loading } from "../../components/Status";
import { incusAt, incusGet, incusPut } from "../../api/client";
import type { Instance } from "../../api/types";
import { nameOf } from "../inventory/tree";

/** The instance keys balancing reads (server/src/balancing/engine.ts). */
export const RULE_KEYS = {
  affinity: "user.incuscloud.affinity",
  antiAffinity: "user.incuscloud.anti-affinity",
  pin: "user.incuscloud.pin",
  balance: "user.incuscloud.balance",
} as const;

/** What Incus takes back on PUT /1.0/instances/<name>: the writable fields of what it gave. */
interface IncusInstance {
  architecture: string;
  config: Record<string, string>;
  devices: Record<string, Record<string, string>>;
  ephemeral: boolean;
  profiles: string[];
  stateful: boolean;
  description: string;
}

const instanceUrl = (i: Instance) => `/1.0/instances/${encodeURIComponent(i.name)}?project=${encodeURIComponent(i.project)}`;

/**
 * How balancing treats one instance: the group it stays with, the group it stays apart from, the
 * members it may run on, or never moving it. Written as keys on the instance, as the caller.
 */
const BalancingRules: FC<{ instance: Instance; onClose: () => void }> = ({ instance, onClose }) => {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ["incus-instance", instance.clusterName, instance.project, instance.name], queryFn: () => incusGet<IncusInstance>(instance.clusterName, instanceUrl(instance)), staleTime: 0 });
  const members = useQuery({
    queryKey: ["incus-members", instance.clusterName],
    queryFn: () => incusAt<Array<{ server_name: string }>>(instance.clusterName, "/1.0/cluster/members?recursion=1"),
  });
  // Group names already used in the project, to pick from.
  const siblings = useQuery({
    queryKey: ["incus-instances", instance.clusterName, instance.project],
    queryFn: () => incusAt<Array<{ name: string; config: Record<string, string> }>>(instance.clusterName, `/1.0/instances?project=${encodeURIComponent(instance.project)}&recursion=1`),
  });

  if (current.isPending) return <Modal onClose={onClose}><Loading /></Modal>;
  if (current.error) return <Modal onClose={onClose}><ErrorMessage error={current.error} /></Modal>;
  const groups = [...new Set((siblings.data ?? []).flatMap((s) => [s.config[RULE_KEYS.affinity], s.config[RULE_KEYS.antiAffinity]]).filter(Boolean) as string[])].sort();
  return (
    <RulesForm
      instance={instance}
      config={current.data.metadata.config}
      // The facade qualifies member names (node1@prod); the pin key takes them plain.
      members={(members.data ?? []).map((m) => nameOf(m.server_name))}
      groups={groups}
      onClose={onClose}
      onSave={async (rules) => {
        // Fresh read, so the write only changes these keys of what is there now.
        const { metadata, etag } = await incusGet<IncusInstance>(instance.clusterName, instanceUrl(instance));
        const config = { ...metadata.config };
        const set = (k: string, v: string) => (v ? (config[k] = v) : delete config[k]);
        set(RULE_KEYS.affinity, rules.affinity);
        set(RULE_KEYS.antiAffinity, rules.antiAffinity);
        set(RULE_KEYS.pin, rules.pin.join(","));
        set(RULE_KEYS.balance, rules.never ? "false" : "");
        const { architecture, devices, ephemeral, profiles, stateful, description } = metadata;
        await incusPut(instance.clusterName, instanceUrl(instance), { architecture, config, devices, ephemeral, profiles, stateful, description }, etag);
        // Refetched in the background: the inventory reads every cluster, and the dialog need not wait for that.
        void qc.invalidateQueries({ queryKey: ["incus-instance", instance.clusterName, instance.project, instance.name] });
        void qc.invalidateQueries({ queryKey: ["inventory"] });
      }}
    />
  );
};

/** A plain modal for the loading and error states, with the same title as the form. */
const Modal: FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <FormModal title="Balancing rules" submitLabel="Save" submitDisabled onSubmit={async () => {}} onClose={onClose}>
    {children}
  </FormModal>
);

interface Rules {
  affinity: string;
  antiAffinity: string;
  pin: string[];
  never: boolean;
}

const RulesForm: FC<{ instance: Instance; config: Record<string, string>; members: string[]; groups: string[]; onClose: () => void; onSave: (r: Rules) => Promise<void> }> = ({
  instance,
  config,
  members,
  groups,
  onClose,
  onSave,
}) => {
  const [r, setR] = useState<Rules>({
    affinity: config[RULE_KEYS.affinity] ?? "",
    antiAffinity: config[RULE_KEYS.antiAffinity] ?? "",
    pin: (config[RULE_KEYS.pin] ?? "").split(",").map((m) => m.trim()).filter(Boolean),
    never: config[RULE_KEYS.balance] === "false",
  });
  const listId = `balancing-groups-${instance.id}`;
  const togglePin = (m: string) => setR({ ...r, pin: r.pin.includes(m) ? r.pin.filter((x) => x !== m) : [...r.pin, m] });
  // Pinned members that are no longer in the cluster still show, so they can be removed.
  const pinChoices = [...new Set([...members, ...r.pin])];
  return (
    <FormModal title={`Balancing rules for ${instance.name}`} submitLabel="Save" onClose={onClose} onSubmit={() => onSave({ ...r, affinity: r.affinity.trim(), antiAffinity: r.antiAffinity.trim() })}>
      <p className="u-text--muted">
        Balancing on <strong>{instance.clusterName}</strong> moves instances between its members. These rules steer it for this instance. Groups are per project
        ({instance.project}).
      </p>
      <CheckboxInput id="rules-never" label="Never move this instance" checked={r.never} onChange={() => setR({ ...r, never: !r.never })} />
      <Input
        id="rules-affinity"
        type="text"
        label="Keep together with group"
        help="Instances in the same group stay on one member."
        list={listId}
        disabled={r.never}
        value={r.affinity}
        onChange={(e) => setR({ ...r, affinity: e.target.value })}
      />
      <Input
        id="rules-anti-affinity"
        type="text"
        label="Keep apart from group"
        help="Instances in the same group stay on different members."
        list={listId}
        disabled={r.never}
        value={r.antiAffinity}
        onChange={(e) => setR({ ...r, antiAffinity: e.target.value })}
      />
      <datalist id={listId}>
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <fieldset disabled={r.never}>
        <legend>Only on these members</legend>
        {pinChoices.length ? (
          pinChoices.map((m) => <CheckboxInput key={m} id={`rules-pin-${m}`} label={m} checked={r.pin.includes(m)} onChange={() => togglePin(m)} />)
        ) : (
          <p className="u-text--muted">This cluster has no members to pin to.</p>
        )}
        <p className="p-form-help-text">None ticked: any member.</p>
      </fieldset>
      {r.affinity && r.affinity === r.antiAffinity ? (
        <Notification severity="caution" title="Same group twice">
          The instance can't stay both with and apart from the same group.
        </Notification>
      ) : null}
    </FormModal>
  );
};

export default BalancingRules;
