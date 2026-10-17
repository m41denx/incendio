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
  "group-owner",
  "unrestricted-user",
  "user",
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

/** Users and service accounts (and, with `groups`, groups and tenants' default groups) as `<type>:<id>` options, for subject pickers. */
export function useSubjects(o: { groups?: boolean } = {}) {
  // Groups are the platform's: others are refused, and offered none.
  const groups = useQuery({
    queryKey: ["groups"],
    enabled: !!o.groups,
    retry: false,
    queryFn: () => request<Array<{ id: string; name: string }>>("GET", "/api/v1/groups"),
  });
  const tenants = useQuery({
    queryKey: ["tenants"],
    enabled: !!o.groups,
    queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"),
  });
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
    ...(o.groups ? (groups.data ?? []) : []).map((g) => ({
      value: `group:${g.id}`,
      label: `${g.name} (group)`,
    })),
    ...(o.groups ? (tenants.data ?? []) : []).map((t) => ({
      value: `tenant:${t.id}`,
      label: `${t.slug}/members (tenant's members)`,
    })),
  ];
}

/** A cluster's Incus cluster groups, from the inventory's members ("default" on a standalone server). */
export const useClusterGroups = (clusterId: string | undefined) =>
  useQuery({
    queryKey: ["cluster-groups", clusterId],
    enabled: !!clusterId,
    queryFn: async () => {
      const inv = await request<{ members: Array<{ groups?: string[] }> }>("GET", `/api/v1/clusters/${clusterId}/inventory`);
      return [...new Set(["default", ...inv.members.flatMap((m) => m.groups ?? [])])].sort();
    },
  });

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

/** A cluster's projects and instances from the inventory, for the project and instance pickers. */
export const useClusterInstances = (clusterId: string | undefined) =>
  useQuery({
    queryKey: ["instances", "picker", clusterId],
    enabled: !!clusterId,
    queryFn: () =>
      request<{ items: Array<{ project: string; name: string }> }>(
        "GET",
        `/api/v1/instances?${new URLSearchParams({ cluster: clusterId!, limit: "500" })}`,
      ),
  });
