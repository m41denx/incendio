import { desc, eq } from "drizzle-orm";
import { db } from "./index.ts";
import type { MachineStatus } from "../lib/capi-status.ts";
import {
  audit,
  clusters,
  type ClusterRow,
  type ClusterStatus,
  type NewClusterRow,
} from "./schema.ts";

/**
 * Thin data-access helpers over the sqlite cache. No business logic lives here;
 * routes compose these. Remember this is a cache/log, not the source of truth
 * (docs/k8s/management-appliance.md §6).
 */

export interface ClusterView {
  id: string;
  name: string;
  project: string | null;
  kubernetesVersion: string;
  controlPlaneCount: number;
  workerCount: number;
  status: ClusterStatus;
  spec: unknown;
  createdAt: string;
  updatedAt: string;
}

function toView(row: ClusterRow): ClusterView {
  return {
    id: row.id,
    name: row.name,
    project: row.project,
    kubernetesVersion: row.k8sVersion,
    controlPlaneCount: row.cpCount,
    workerCount: row.workerCount,
    status: row.status as ClusterStatus,
    spec: row.specJson ? safeParse(row.specJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export interface CreateClusterInput {
  name: string;
  project?: string | null;
  kubernetesVersion: string;
  controlPlaneCount: number;
  workerCount: number;
  status?: ClusterStatus;
  spec?: unknown;
}

export const clusterRepo = {
  list(): ClusterView[] {
    return db
      .select()
      .from(clusters)
      .orderBy(desc(clusters.createdAt))
      .all()
      .map(toView);
  },

  getByName(name: string): ClusterView | undefined {
    const row = db
      .select()
      .from(clusters)
      .where(eq(clusters.name, name))
      .get();
    return row ? toView(row) : undefined;
  },

  create(input: CreateClusterInput): ClusterView {
    const now = new Date().toISOString();
    const values: NewClusterRow = {
      id: crypto.randomUUID(),
      name: input.name,
      project: input.project ?? null,
      k8sVersion: input.kubernetesVersion,
      cpCount: input.controlPlaneCount,
      workerCount: input.workerCount,
      status: input.status ?? "pending",
      specJson: input.spec === undefined ? null : JSON.stringify(input.spec),
      createdAt: now,
      updatedAt: now,
    };
    const row = db.insert(clusters).values(values).returning().get();
    return toView(row);
  },

  setStatus(name: string, status: ClusterStatus): ClusterView | undefined {
    const row = db
      .update(clusters)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(clusters.name, name))
      .returning()
      .get();
    return row ? toView(row) : undefined;
  },

  /** Mirror desired replicas/version (CAPI topology stays authoritative). */
  setDesired(
    name: string,
    desired: {
      controlPlaneCount?: number;
      workerCount?: number;
      kubernetesVersion?: string;
    },
  ): ClusterView | undefined {
    const row = db
      .update(clusters)
      .set({
        ...(desired.controlPlaneCount !== undefined
          ? { cpCount: desired.controlPlaneCount }
          : {}),
        ...(desired.workerCount !== undefined
          ? { workerCount: desired.workerCount }
          : {}),
        ...(desired.kubernetesVersion !== undefined
          ? { k8sVersion: desired.kubernetesVersion }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(clusters.name, name))
      .returning()
      .get();
    return row ? toView(row) : undefined;
  },

  deleteByName(name: string): boolean {
    const row = db
      .delete(clusters)
      .where(eq(clusters.name, name))
      .returning()
      .get();
    return row !== undefined;
  },
};

export const auditRepo = {
  record(action: string, detail?: string, actor?: string): void {
    db.insert(audit)
      .values({
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        actor: actor ?? null,
        action,
        detail: detail ?? null,
      })
      .run();
  },
};

/**
 * Shape returned by GET /v1/clusters/:name/status. Today it is derived from the
 * local cache (CAPN is not wired: /v1/info reports capn:false). Once the agent
 * watches CAPI/CAPN CRDs, `source` becomes "crd" and the counts/conditions are
 * filled from Cluster/Machine conditions — the CRDs stay authoritative.
 */
export interface ClusterStatusView {
  name: string;
  status: ClusterStatus;
  ready: boolean;
  source: "cache" | "crd";
  controlPlane: { desired: number; ready: number | null };
  workers: { desired: number; ready: number | null };
  // Live-only fields (source "crd"); absent when served from the cache.
  phase?: string;
  /** Target Kubernetes version (spec.topology.version). */
  version?: string;
  rollout?: "upgrading" | "scaling";
  message?: string;
  endpoint?: string;
  machines?: MachineStatus[];
  conditions: unknown[];
  updatedAt: string;
}

export function deriveStatus(view: ClusterView): ClusterStatusView {
  return {
    name: view.name,
    status: view.status,
    ready: view.status === "ready",
    source: "cache",
    controlPlane: { desired: view.controlPlaneCount, ready: null },
    workers: { desired: view.workerCount, ready: null },
    conditions: [],
    updatedAt: view.updatedAt,
  };
}
