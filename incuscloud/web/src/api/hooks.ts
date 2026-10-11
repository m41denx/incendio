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

/** Whether the caller holds at least this platform role. */
export const can = (me: Me | undefined, level: PlatformRole) => !!me?.platformRole && RANK[me.platformRole] >= RANK[level];

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
