import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../api/client";
import { can } from "../../api/hooks";
import type { Me, Tenant } from "../../api/types";

/**
 * A URL query parameter, so that filters can be shared as links. Writing ""
 * removes it. With `debounceMs`, typing updates `draft` at once and the URL
 * (and so `value`, which the queries use) after the typing pauses.
 */
export function useUrlParam(name: string, debounceMs = 0) {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? "";
  const [draft, setDraft] = useState(value);
  const commit = useCallback(
    (next: string) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set(name, next);
          else p.delete(name);
          return p;
        },
        { replace: true },
      ),
    [name, setParams],
  );
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!debounceMs || draft === value) return;
    const t = window.setTimeout(() => commit(draft), debounceMs);
    return () => window.clearTimeout(t);
  }, [draft, value, debounceMs, commit]);
  const set = (next: string) => {
    setDraft(next);
    if (!debounceMs) commit(next);
  };
  return { value, draft, set };
}

export interface TenantScope {
  /** Platform viewers see every tenant and may pick "All". */
  platform: boolean;
  /** The tenant to query by, or "" for all tenants (platform viewers only). */
  value: string;
  options: Array<{ value: string; label: string }>;
  /** A caller who owns or administers no tenant has nothing to query. */
  none: boolean;
  set: (tenantId: string) => void;
}

/**
 * The log pages' tenant scope, in the `tenant` URL parameter. Platform viewers
 * get every tenant plus "All"; others only the tenants they own or administer,
 * with the first one chosen when the URL names none of them.
 */
export function useTenantScope(me: Me | undefined): TenantScope {
  const param = useUrlParam("tenant");
  const platform = can(me, "viewer");
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"), enabled: platform });
  const mine = useMemo(() => (me?.tenants ?? []).filter((t) => t.role === "owner" || t.role === "admin"), [me]);
  if (platform) {
    return {
      platform,
      value: param.value,
      none: false,
      options: [{ value: "", label: "All tenants" }, ...(tenants.data ?? []).map((t) => ({ value: t.id, label: t.name }))],
      set: param.set,
    };
  }
  return {
    platform,
    value: mine.find((t) => t.id === param.value)?.id ?? mine[0]?.id ?? "",
    none: !!me && mine.length === 0,
    options: mine.map((t) => ({ value: t.id, label: t.name })),
    set: param.set,
  };
}

export const TenantScopeSelect: FC<{ scope: TenantScope }> = ({ scope }) => (
  <Select id="tenant-scope" label="Tenant scope" options={scope.options} value={scope.value} disabled={scope.none} onChange={(e) => scope.set(e.target.value)} />
);
