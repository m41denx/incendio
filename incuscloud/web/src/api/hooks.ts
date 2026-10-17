import { QueryClient, useQuery } from "@tanstack/react-query";
import { ApiError, request } from "./client";
import type { Me, PlatformRole, TenantRole } from "./types";

export const queryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // 4xx answers will not change by asking again.
        retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
        refetchOnWindowFocus: false,
      },
    },
  });

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => request<Me>("GET", "/api/v1/me"), staleTime: 60_000 });

const RANK: Record<PlatformRole, number> = { viewer: 1, operator: 2, admin: 3 };
/** The privilege on / that only holders of each former platform role have. */
const LEVEL: Record<PlatformRole, string> = { admin: "platform.users", operator: "cluster.configure", viewer: "cluster.view" };

/** Whether the caller holds at least this platform role: its privilege on /, or (older servers) the role. */
export const can = (me: Me | undefined, level: PlatformRole) =>
  me?.rootPrivileges ? me.rootPrivileges.includes(LEVEL[level]) : !!me?.platformRole && RANK[me.platformRole] >= RANK[level];

/** Whether the caller holds a privilege on / (permissions). */
export const canAtRoot = (me: Me | undefined, privilege: string) => !!me?.rootPrivileges?.includes(privilege);

/**
 * A cluster's API address for API clients (`<name>.<clusterDomain>`, spec D11),
 * on the public URL's port when it is not the default.
 */
export function clusterApiUrl(me: Pick<Me, "clusterDomain" | "publicUrl"> | undefined, name: string): string {
  const port = me ? new URL(me.publicUrl).port : "";
  return `https://${name}.${me?.clusterDomain ?? ""}${port ? `:${port}` : ""}`;
}

/** The caller's role in a tenant, if a member. */
export const tenantRole = (me: Me | undefined, tenantId: string): TenantRole | undefined => me?.tenants.find((t) => t.id === tenantId)?.role;

/** Every reachable cluster's members through the console's Incus API (`name@cluster`); empty when it cannot say. */
export const useConsoleMembers = () =>
  useQuery({
    queryKey: ["console", "members"],
    queryFn: async () => (await request<{ metadata?: Array<{ server_name: string; status: string }> }>("GET", "/1.0/cluster/members?recursion=1")).metadata ?? [],
    staleTime: 30_000,
  });
