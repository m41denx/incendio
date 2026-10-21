import { type FC, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, CheckboxInput, Input, Notification, RadioInput, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { ErrorMessage } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { Instance, Job, MigrationCheck, TenantPlacement } from "../../api/types";
import { useClusters } from "../clusters/ClusterList";

type Mode = "move" | "copy";
type Transport = "auto" | "direct" | "relay";

/** Where the caller may send the instance: any other cluster for operators, the tenant's other ready placements otherwise. */
function useTargets(instance: Instance, operator: boolean) {
  const clusters = useClusters();
  const placements = useQuery({
    queryKey: ["tenants", instance.tenantId, "placements"],
    queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${instance.tenantId}/placements`),
    enabled: !operator && !!instance.tenantId,
  });
  if (operator) return (clusters.data ?? []).filter((c) => c.id !== instance.clusterId).map((c) => ({ id: c.id, name: c.name }));
  return (placements.data ?? []).filter((p) => p.status === "ready" && p.clusterId !== instance.clusterId).map((p) => ({ id: p.clusterId, name: p.clusterName }));
}

/**
 * Moving or copying an instance to another cluster: choose, check (pre-flight
 * on both clusters), then start; the job page follows it.
 */
const MigrateInstance: FC<{ instance: Instance; onClose: () => void; /** A cluster to choose first (a balancing suggestion). */ initialTarget?: string }> = ({ instance, onClose, initialTarget }) => {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const operator = can(me, "operator");
  const targets = useTargets(instance, operator);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<Mode>("move");
  const [name, setName] = useState(instance.name);
  const [live, setLive] = useState(false);
  const [transport, setTransport] = useState<Transport>("auto");
  const [check, setCheck] = useState<MigrationCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const liveAllowed = instance.type === "virtual-machine" && instance.status === "Running" && mode === "move";

  useEffect(() => {
    if (!target && targets.length) setTarget((targets.find((t) => t.id === initialTarget) ?? targets[0]!).id);
  }, [target, targets, initialTarget]);
  // Any change makes the last check stale.
  useEffect(() => setCheck(null), [target, mode, name, live, transport]);

  const body = () => ({
    targetClusterId: target,
    mode,
    targetName: name,
    ...(liveAllowed && live ? { live: true } : {}),
    ...(operator && transport !== "auto" ? { transport } : {}),
  });
  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await request<MigrationCheck>("POST", `/api/v1/instances/${instance.id}/migrations/preflight`, body()));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };
  const start = async () => {
    const job = await request<Job>("POST", `/api/v1/instances/${instance.id}/migrations`, body());
    navigate(`/jobs/${job.id}`);
  };
  const targetName = targets.find((t) => t.id === target)?.name ?? "";

  return (
    <FormModal title={`Move or copy ${instance.name}`} submitLabel="Start" onSubmit={start} onClose={onClose} submitDisabled={!check?.ok}>
      {targets.length === 0 ? (
        <Notification severity="information" title="Nowhere to go">
          {operator ? "There is no other cluster." : "The tenant must be placed on another cluster first."}
        </Notification>
      ) : null}
      <Select id="migrate-target" label="Target cluster" value={target} options={targets.map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => setTarget(e.target.value)} />
      <fieldset>
        <legend>What happens to the source</legend>
        <RadioInput label="Move" name="migrate-mode" checked={mode === "move"} onChange={() => setMode("move")} />
        <RadioInput label="Copy" name="migrate-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
      </fieldset>
      <Input id="migrate-name" type="text" label="Name on the target" value={name} onChange={(e) => setName(e.target.value)} />
      {liveAllowed ? (
        <>
          <CheckboxInput label="Move live" checked={live} onChange={() => setLive(!live)} />
          <p className="p-form-help-text">Needs migration.stateful=true; the VM keeps running.</p>
        </>
      ) : null}
      {operator ? (
        <Select
          id="migrate-transport"
          label="Transport"
          value={transport}
          onChange={(e) => setTransport(e.target.value as Transport)}
          options={[
            { value: "auto", label: "Automatic" },
            { value: "direct", label: "Direct (the source connects to the target)" },
            { value: "relay", label: "Relay through the control plane" },
          ]}
        />
      ) : null}
      <Button type="button" onClick={runCheck} disabled={!target || !name || checking}>
        Check
      </Button>
      {error ? <ErrorMessage error={error} title="Check failed" /> : null}
      {check && !check.ok ? (
        <Notification severity="negative" title="This cannot go ahead">
          <ul className="p-list">
            {check.problems.map((p) => (
              <li key={p} className="p-list__item">
                {p}
              </li>
            ))}
          </ul>
        </Notification>
      ) : null}
      {check?.ok ? (
        <Notification severity="positive" title={`Ready to ${mode} to ${check.targetProject} on ${targetName}`}>
          {check.warnings.length ? (
            <ul className="p-list">
              {check.warnings.map((w) => (
                <li key={w} className="p-list__item">
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            "No warnings."
          )}
        </Notification>
      ) : null}
    </FormModal>
  );
};

export default MigrateInstance;
