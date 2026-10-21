import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "../../api/client";
import { can, tenantRole } from "../../api/hooks";
import type { CreateK8sRequest, Job, K8sActivityEntry, K8sCluster, K8sClusterStatus, K8sMetalLB, K8sNode, K8sOptions, Me } from "../../api/types";

// Incendio's Kubernetes hooks (pages/kubernetes/useK8sClusters.ts), over
// IncusCloud's /api/v1/kubernetes by id instead of the appliance agent by name.
// Reads poll like Incendio's, so status changes show without a refresh.

const POLL_MS = 5_000;
const KEY = ["kubernetes"];

export const useK8sOptions = () => useQuery({ queryKey: [...KEY, "versions"], queryFn: () => request<K8sOptions>("GET", "/api/v1/kubernetes/versions"), staleTime: 60_000 });

/** The clusters of the tenants the caller can see; 409 (no management cluster) is an empty list. */
export const useK8sClusters = (filters: { tenant?: string; cluster?: string } = {}) =>
  useQuery({
    queryKey: [...KEY, "list", filters.tenant ?? ""],
    queryFn: async () => {
      try {
        return await request<K8sCluster[]>("GET", `/api/v1/kubernetes${filters.tenant ? `?tenant=${encodeURIComponent(filters.tenant)}` : ""}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return [];
        throw e;
      }
    },
    select: (list) => (filters.cluster ? list.filter((k) => k.clusterName === filters.cluster) : list),
    refetchInterval: POLL_MS,
  });

export const useK8sCluster = (id: string) =>
  useQuery({ queryKey: [...KEY, id], queryFn: () => request<K8sCluster>("GET", `/api/v1/kubernetes/${id}`), enabled: !!id, refetchInterval: POLL_MS });

export const useK8sClusterStatus = (id: string) =>
  useQuery({ queryKey: [...KEY, id, "status"], queryFn: () => request<K8sClusterStatus>("GET", `/api/v1/kubernetes/${id}/status`), enabled: !!id, refetchInterval: POLL_MS, retry: false });

export const useK8sNodes = (id: string) =>
  useQuery({ queryKey: [...KEY, id, "nodes"], queryFn: () => request<K8sNode[]>("GET", `/api/v1/kubernetes/${id}/nodes`), enabled: !!id, refetchInterval: POLL_MS, retry: false });

export const useK8sClusterActivity = (id: string, enabled = true, interval = POLL_MS) =>
  useQuery({
    queryKey: [...KEY, id, "activity"],
    queryFn: async () => (await request<{ entries: K8sActivityEntry[] }>("GET", `/api/v1/kubernetes/${id}/activity`)).entries,
    enabled: !!id && enabled,
    refetchInterval: interval,
    retry: false,
  });

export const useK8sMetalLB = (id: string, enabled = true) =>
  useQuery({ queryKey: [...KEY, id, "metallb"], queryFn: () => request<K8sMetalLB>("GET", `/api/v1/kubernetes/${id}/metallb`), enabled: !!id && enabled, refetchInterval: POLL_MS * 3, retry: false });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
};

export const useCreateK8sCluster = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateK8sRequest) => request<{ cluster: K8sCluster; job: Job }>("POST", "/api/v1/kubernetes", body),
    onSuccess: invalidate,
  });
};

export interface K8sClusterPatch {
  controlPlanes?: 1 | 3 | 5;
  workers?: number;
  version?: string;
}

/** PATCH: replicas or version in the CAPI topology. */
export const usePatchK8sCluster = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (patch: K8sClusterPatch) => request<K8sCluster>("PATCH", `/api/v1/kubernetes/${id}`, patch), onSuccess: invalidate });
};

export const useDeleteK8sCluster = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => request<{ job: Job }>("DELETE", `/api/v1/kubernetes/${id}`), onSuccess: invalidate });
};

export const useSetK8sMetalLB = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (addresses: string[]) => request<{ cluster: K8sCluster; job: Job }>("PUT", `/api/v1/kubernetes/${id}/metallb`, { addresses }), onSuccess: invalidate });
};

/** The admin kubeconfig, as text (audited by the API). */
export async function fetchKubeconfig(id: string): Promise<string> {
  const r = await fetch(`/api/v1/kubernetes/${id}/kubeconfig`, { credentials: "same-origin" });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
  }
  return r.text();
}

/** Tenant members and up, and platform operators, create, scale, upgrade and set MetalLB. */
export const canChange = (me: Me | undefined, tenantId: string) => can(me, "operator") || ["owner", "admin", "member"].includes(tenantRole(me, tenantId) ?? "");
/** Tenant owners and admins, and platform operators, delete. */
export const canDelete = (me: Me | undefined, tenantId: string) => can(me, "operator") || ["owner", "admin"].includes(tenantRole(me, tenantId) ?? "");

/** Statuses in which a job owns the cluster: nothing to change meanwhile. */
export const busy = (k: Pick<K8sCluster, "status">) => k.status === "creating" || k.status === "provisioning" || k.status === "deleting";

export const clusterUrl = (id: string) => `/kubernetes/${encodeURIComponent(id)}`;

/** Requested explicitly; never poll cluster-admin credentials. */
export const useK8sKubeconfig = (id: string, enabled: boolean) => useQuery({ queryKey: [...KEY,id,"kubeconfig"], queryFn: () => fetchKubeconfig(id), enabled: !!id && enabled, retry: false, gcTime: 0 });
