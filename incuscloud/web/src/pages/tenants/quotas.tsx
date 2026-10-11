import type { FC } from "react";
import { Input } from "@canonical/react-components";
import type { Quotas } from "../../api/types";

type Key = keyof Quotas;
export const QUOTA_FIELDS: Array<{ key: Key; label: string; summary: (n: number) => string }> = [
  { key: "instances", label: "Instances", summary: (n) => `${n} instances` },
  { key: "cpu", label: "CPUs", summary: (n) => `${n} CPUs` },
  { key: "memory", label: "Memory (GiB)", summary: (n) => `${n} GiB memory` },
  { key: "disk", label: "Disk (GiB)", summary: (n) => `${n} GiB disk` },
];

export const quotaSummary = (q: Quotas) =>
  QUOTA_FIELDS.filter((f) => q[f.key] !== undefined)
    .map((f) => f.summary(q[f.key]!))
    .join(", ") || "No quotas";

/** Form state: one string per field ("" = no quota). */
export type QuotaDraft = Record<Key, string>;
export const draftOf = (q: Quotas): QuotaDraft => ({ instances: q.instances?.toString() ?? "", cpu: q.cpu?.toString() ?? "", memory: q.memory?.toString() ?? "", disk: q.disk?.toString() ?? "" });
export const quotasOf = (d: QuotaDraft): Quotas => Object.fromEntries(Object.entries(d).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)])) as Quotas;
export const draftValid = (d: QuotaDraft) => Object.values(d).every((v) => v.trim() === "" || /^\d+$/.test(v.trim()));

/** The four quota inputs; empty means unlimited. */
export const QuotaFields: FC<{ value: QuotaDraft; onChange: (d: QuotaDraft) => void }> = ({ value, onChange }) => (
  <>
    {QUOTA_FIELDS.map((f) => (
      <Input
        key={f.key}
        id={`quota-${f.key}`}
        label={f.label}
        type="number"
        min={0}
        step={1}
        value={value[f.key]}
        onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
        error={value[f.key] && !/^\d+$/.test(value[f.key]) ? "A whole number" : undefined}
      />
    ))}
    <p className="ic-muted">Empty means no limit. Each cluster the tenant is placed on enforces these on the tenant's project.</p>
  </>
);
