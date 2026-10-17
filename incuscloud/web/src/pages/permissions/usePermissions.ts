import { useQuery } from "@tanstack/react-query";
import { request } from "../../api/client";
import type {
  AclEntry,
  AclRole,
  Cluster,
  ServiceAccount,
  Tenant,
  User,
} from "../../api/types";

/** Roles that can be given in this release (the server refuses the others). */
export const GIVABLE = [
  "administrator",
  "operator",
  "cluster-owner",
  "unrestricted-user",
  "tenant-admin",
  "auditor",
  "no-access",
];

export const SOURCE_LABEL: Record<AclEntry["source"], string> = {
  acl: "Permission",
  "platform-role": "Platform role",
  "tenant-membership": "Tenant membership",
  "service-account": "Service account",
};

export const useAclRoles = () =>
  useQuery({
    queryKey: ["acl", "roles"],
    queryFn: () => request<AclRole[]>("GET", "/api/v1/acl/roles"),
    staleTime: 300_000,
  });
export const useAclEntries = (path = "/") =>
  useQuery({
    queryKey: ["acl", "entries", path],
    queryFn: () =>
      request<AclEntry[]>(
        "GET",
        `/api/v1/acl/entries?${new URLSearchParams({ path })}`,
      ),
  });

/** Role id → its name, falling back to the id while roles load. */
export function useRoleName() {
  const roles = useAclRoles().data;
  return (id: string) => roles?.find((r) => r.id === id)?.name ?? id;
}

/** Users and service accounts as `<type>:<id>` options, for subject pickers. */
export function useSubjects() {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => request<User[]>("GET", "/api/v1/users"),
  });
  const accounts = useQuery({
    queryKey: ["service-accounts"],
    queryFn: () => request<ServiceAccount[]>("GET", "/api/v1/service-accounts"),
  });
  return [
    ...(users.data ?? []).map((u) => ({
      value: `user:${u.id}`,
      label: u.email,
    })),
    ...(accounts.data ?? []).map((a) => ({
      value: `service:${a.id}`,
      label: `${a.name} (service account)`,
    })),
  ];
}

export const useClusterNames = () =>
  useQuery({
    queryKey: ["clusters"],
    queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters"),
  });
export const useTenantList = () =>
  useQuery({
    queryKey: ["tenants"],
    queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"),
  });
