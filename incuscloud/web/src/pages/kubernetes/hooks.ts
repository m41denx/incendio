import { useQuery } from "@tanstack/react-query";
import { request } from "../../api/client";
import { can, tenantRole } from "../../api/hooks";
import type { K8sOptions, K8sSize, Me } from "../../api/types";

export const useK8sOptions = () => useQuery({ queryKey: ["kubernetes", "versions"], queryFn: () => request<K8sOptions>("GET", "/api/v1/kubernetes/versions"), staleTime: 60_000 });

/** Tenant members and up, and platform operators, create, scale and upgrade. */
export const canChange = (me: Me | undefined, tenantId: string) => can(me, "operator") || ["owner", "admin", "member"].includes(tenantRole(me, tenantId) ?? "");
/** Tenant owners and admins, and platform operators, delete. */
export const canDelete = (me: Me | undefined, tenantId: string) => can(me, "operator") || ["owner", "admin"].includes(tenantRole(me, tenantId) ?? "");

export const sizeLabel = (options: K8sOptions | undefined, size: K8sSize) => {
  const s = options?.sizes[size];
  const name = size[0]!.toUpperCase() + size.slice(1);
  return s ? `${name} (${s.cpu} CPUs, ${s.memoryGiB} GiB)` : name;
};
