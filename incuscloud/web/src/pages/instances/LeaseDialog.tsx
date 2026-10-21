import { type FC, useState } from "react";
import { ActionButton, CheckboxInput, Input, Notification } from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import KeyValues from "../../components/KeyValues";
import { ErrorMessage } from "../../components/Status";
import { request } from "../../api/client";
import type { Instance, Lease } from "../../api/types";

/** "in 3 days", "in 5 h", "ended 2 days ago": a lease's end from now. */
export function leaseEnd(lease: Pick<Lease, "expiresAt">, now = Date.now()): string {
  if (!lease.expiresAt) return "never ends";
  const ms = new Date(lease.expiresAt).getTime() - now;
  const abs = Math.abs(ms);
  const span = abs < 3600_000 ? `${Math.max(1, Math.round(abs / 60_000))} min` : abs < 2 * 86400_000 ? `${Math.round(abs / 3600_000)} h` : `${Math.round(abs / 86400_000)} days`;
  return ms >= 0 ? `ends in ${span}` : `ended ${span} ago`;
}

/** "1 day", "3 days". */
export const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export const ACTION_TEXT: Record<Lease["action"], string> = { stop: "stopped", delete: "deleted" };

/** `<input type="datetime-local">` value for a date, in local time. */
const localInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 7 * 86400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * An instance's lease: when it ends and what happens then, extending it as the tenant's policy
 * allows, and (for the platform) setting its end or exempting it.
 */
const LeaseDialog: FC<{ instance: Instance; onClose: () => void }> = ({ instance, onClose }) => {
  const qc = useQueryClient();
  const [lease, setLease] = useState<Lease>(instance.lease!);
  const [error, setError] = useState<unknown>(null);
  const [extending, setExtending] = useState(false);
  const [never, setNever] = useState(!lease.expiresAt);
  const [end, setEnd] = useState(localInput(lease.expiresAt));
  const canExtend = !!instance.privileges?.includes("instance.configure") && !!lease.expiresAt && lease.extensions < lease.maxExtensions;
  const refresh = () => qc.invalidateQueries({ queryKey: ["instances"] });
  const extend = async () => {
    setExtending(true);
    setError(null);
    try {
      const next = await request<Lease>("POST", `/api/v1/instances/${instance.id}/lease/extend`);
      setLease(next);
      setEnd(localInput(next.expiresAt));
      void refresh();
    } catch (e) {
      setError(e);
    } finally {
      setExtending(false);
    }
  };
  const ended = !!lease.expiresAt && new Date(lease.expiresAt).getTime() < Date.now();
  return (
    <FormModal
      title={`Lease of ${instance.name}`}
      submitLabel={instance.canSetLease ? "Save" : "Done"}
      onClose={onClose}
      onSubmit={async () => {
        if (!instance.canSetLease) return;
        await request("PUT", `/api/v1/instances/${instance.id}/lease`, { expiresAt: never ? null : new Date(end).toISOString() });
        await refresh();
      }}
    >
      {ended ? (
        <Notification severity="caution" title="The lease has ended">
          {lease.action === "stop" ? "The instance is kept stopped until the lease is extended." : "The instance is being deleted."}
        </Notification>
      ) : null}
      <KeyValues
        items={[
          ["Ends", lease.expiresAt ? `${new Date(lease.expiresAt).toLocaleString()} (${leaseEnd(lease)})` : "Never"],
          ["Then", `The instance is ${ACTION_TEXT[lease.action]}`],
          ["Extensions", `${lease.extensions} of ${lease.maxExtensions} used, ${days(lease.extendDays)} each`],
        ]}
      />
      {error ? <ErrorMessage error={error} title="Not extended" /> : null}
      {lease.expiresAt ? (
        <p>
          <ActionButton type="button" loading={extending} disabled={!canExtend || extending} onClick={extend}>
            Extend by {days(lease.extendDays)}
          </ActionButton>
          {!canExtend && lease.extensions >= lease.maxExtensions ? <span className="u-text--muted"> No extensions left: ask a platform operator.</span> : null}
        </p>
      ) : null}
      {instance.canSetLease ? (
        <>
          <h3 className="p-heading--5">Set the end (platform)</h3>
          <CheckboxInput id="lease-never" label="Never ends" checked={never} onChange={() => setNever(!never)} />
          <Input id="lease-end" type="datetime-local" label="Ends at" value={end} disabled={never} onChange={(e) => setEnd(e.target.value)} />
        </>
      ) : null}
    </FormModal>
  );
};

export default LeaseDialog;
