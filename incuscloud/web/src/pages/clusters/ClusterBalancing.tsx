import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionButton, Button, CheckboxInput, Input, MainTable, Notification, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import KeyValues from "../../components/KeyValues";
import { ErrorMessage, Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import type { BalanceReason, BalancingMethod, BalancingMode, BalancingPlan, BalancingPolicy, BalancingSettings, Job } from "../../api/types";
import Section from "../../components/Section";

const METHOD_LABEL: Record<BalancingMethod, string> = { memory: "memory", cpu: "CPU", disk: "disk" };
const REASON_LABEL: Record<BalanceReason, string> = { balance: "Balance", pin: "Pinned elsewhere", affinity: "Keep together", "anti-affinity": "Keep apart" };
const METHOD_OPTIONS = [
  { label: "Memory", value: "memory" },
  { label: "CPU", value: "cpu" },
  { label: "Disk", value: "disk" },
];
const MODE_OPTIONS = [
  { label: "What instances use", value: "used" },
  { label: "What instances are given", value: "assigned" },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Every 15 min", "Every 1 h", "Every 90 min". */
const every = (intervalS: number) => (intervalS % 3600 === 0 ? `Every ${intervalS / 3600} h` : `Every ${Math.round(intervalS / 60)} min`);

/** "a, b" → ["a", "b"]: trimmed, empties dropped. */
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const whole = (s: string, min: number, max: number) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
};

interface Fields {
  enabled: boolean;
  minutes: string;
  method: BalancingMethod;
  mode: BalancingMode;
  balanciness: string;
  maxMoves: string;
  allowRestart: boolean;
  excludeMembers: string;
  excludeProjects: string;
}

/** Edit the saved policy. Mounted when opened, so it starts from what is saved. */
const SettingsForm: FC<{ clusterId: string; policy: BalancingPolicy; onClose: () => void }> = ({ clusterId, policy, onClose }) => {
  const qc = useQueryClient();
  const [f, setF] = useState<Fields>({
    enabled: policy.enabled,
    minutes: String(Math.round(policy.intervalS / 60)),
    method: policy.method,
    mode: policy.mode,
    balanciness: String(policy.balanciness),
    maxMoves: String(policy.maxMoves),
    allowRestart: policy.allowRestart,
    excludeMembers: policy.excludeMembers.join(", "),
    excludeProjects: policy.excludeProjects.join(", "),
  });
  const set = <K extends keyof Fields>(k: K) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const minutesOk = whole(f.minutes, 5, 1440);
  const spreadOk = whole(f.balanciness, 1, 100);
  const movesOk = whole(f.maxMoves, 1, 50);
  const valid = minutesOk && spreadOk && movesOk;

  const submit = async () => {
    const body: BalancingSettings = {
      enabled: f.enabled,
      intervalS: Number(f.minutes) * 60,
      method: f.method,
      mode: f.mode,
      balanciness: Number(f.balanciness),
      maxMoves: Number(f.maxMoves),
      allowRestart: f.allowRestart,
      excludeMembers: list(f.excludeMembers),
      excludeProjects: list(f.excludeProjects),
    };
    await request("PUT", `/api/v1/clusters/${clusterId}/balancing`, body);
    await qc.invalidateQueries({ queryKey: ["clusters", clusterId, "balancing"] });
  };

  return (
    <FormModal title="Balancing settings" submitLabel="Save" onSubmit={submit} onClose={onClose} submitDisabled={!valid}>
      <CheckboxInput id="balancing-enabled" label="Balance automatically" checked={f.enabled} onChange={() => setF({ ...f, enabled: !f.enabled })} />
      <Input
        id="balancing-minutes"
        label="Every (minutes)"
        type="number"
        min={5}
        max={1440}
        value={f.minutes}
        onChange={set("minutes")}
        error={f.minutes && !minutesOk ? "Between 5 and 1440 minutes" : undefined}
      />
      <Select id="balancing-method" label="Balance by" options={METHOD_OPTIONS} value={f.method} onChange={set("method")} />
      <Select id="balancing-mode" label="Measure" options={MODE_OPTIONS} value={f.mode} onChange={set("mode")} />
      <Input
        id="balancing-spread"
        label="Tolerated spread (points)"
        type="number"
        min={1}
        max={100}
        value={f.balanciness}
        onChange={set("balanciness")}
        error={f.balanciness && !spreadOk ? "Between 1 and 100" : undefined}
      />
      <Input
        id="balancing-moves"
        label="Moves per run"
        type="number"
        min={1}
        max={50}
        value={f.maxMoves}
        onChange={set("maxMoves")}
        error={f.maxMoves && !movesOk ? "Between 1 and 50" : undefined}
      />
      <CheckboxInput id="balancing-restart" label="Allow restarts" checked={f.allowRestart} onChange={() => setF({ ...f, allowRestart: !f.allowRestart })} />
      <p className="p-form-help-text">Running containers and VMs that cannot move live are stopped, moved and started.</p>
      <Input id="balancing-exclude-members" label="Excluded members" type="text" help="Comma-separated. Never balanced from or to." value={f.excludeMembers} onChange={set("excludeMembers")} />
      <Input id="balancing-exclude-projects" label="Excluded projects" type="text" help="Comma-separated. Their instances never move." value={f.excludeProjects} onChange={set("excludeProjects")} />
    </FormModal>
  );
};

/** The cluster's balancing policy: a summary for everyone, and for operators the settings, a preview and a run. */
const ClusterBalancing: FC<{ clusterId: string; canManage: boolean }> = ({ clusterId, canManage }) => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const policy = useQuery({
    queryKey: ["clusters", clusterId, "balancing"],
    queryFn: () => request<BalancingPolicy>("GET", `/api/v1/clusters/${clusterId}/balancing`),
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [plan, setPlan] = useState<BalancingPlan | null>(null);
  const [planError, setPlanError] = useState<unknown>(null);
  const [planning, setPlanning] = useState(false);
  const [runError, setRunError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);

  const preview = async () => {
    setPlanning(true);
    setPlanError(null);
    try {
      setPlan(await request<BalancingPlan>("POST", `/api/v1/clusters/${clusterId}/balancing/plan`, {}));
    } catch (e) {
      setPlan(null);
      setPlanError(e);
    } finally {
      setPlanning(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const job = await request<Job>("POST", `/api/v1/clusters/${clusterId}/balancing/run`);
      await qc.invalidateQueries({ queryKey: ["clusters", clusterId, "balancing"] });
      navigate(`/jobs/${job.id}`);
    } catch (e) {
      setRunError(e);
      setRunning(false);
    }
  };

  return (
    <Section title="Balancing" id="cluster-balancing">
      <Loaded query={policy}>
        {(p) => (
          <>
            {p.lastError ? (
              <Notification severity="caution" title="Last run">
                {p.lastError}
              </Notification>
            ) : null}
            <KeyValues
              items={[
                ["Automatic", p.enabled ? every(p.intervalS) : "Off"],
                ["Balance by", `${METHOD_LABEL[p.method]} ${p.mode}`],
                ["Tolerated spread", plural(p.balanciness, "point", "points")],
                ["At most", plural(p.maxMoves, "move", "moves") + " per run"],
                ["Running instances", p.allowRestart ? "Moved with a restart when needed" : "Only VMs that can move live"],
                ["Excluded members", p.excludeMembers.length ? p.excludeMembers.join(", ") : "None"],
                ["Excluded projects", p.excludeProjects.length ? p.excludeProjects.join(", ") : "None"],
                ["Last run", ago(p.lastRunAt)],
              ]}
            />
            {canManage ? (
              <div className="p-button-group" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <Button type="button" onClick={() => setSettingsOpen(true)}>
                  Settings…
                </Button>
                <ActionButton type="button" loading={planning} disabled={planning} onClick={preview}>
                  Preview
                </ActionButton>
                <ActionButton type="button" appearance="positive" loading={running} disabled={running} onClick={run}>
                  Rebalance now
                </ActionButton>
              </div>
            ) : null}
            {runError ? <ErrorMessage error={runError} title="Not started" /> : null}
            {planError ? <ErrorMessage error={planError} title="Preview failed" /> : null}
            {plan ? (
              <>
                <p>{`Spread now: ${plan.before.toFixed(1)} points; after: ${plan.after.toFixed(1)} points`}</p>
                {plan.notes.map((note, i) => (
                  <p key={i} className="u-text--muted">
                    {note}
                  </p>
                ))}
                {plan.moves.length ? (
                  <MainTable
                    headers={[{ content: "Instance" }, { content: "From" }, { content: "To" }, { content: "Why" }]}
                    rows={plan.moves.map((m) => ({
                      key: `${m.project}/${m.name}`,
                      columns: [{ content: `${m.project}/${m.name}` }, { content: m.from }, { content: m.to }, { content: REASON_LABEL[m.reason] }],
                    }))}
                  />
                ) : (
                  <p>Nothing to move.</p>
                )}
              </>
            ) : null}
            {canManage && settingsOpen ? <SettingsForm clusterId={clusterId} policy={p} onClose={() => setSettingsOpen(false)} /> : null}
          </>
        )}
      </Loaded>
    </Section>
  );
};

export default ClusterBalancing;
