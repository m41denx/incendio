import { lbIsInstance } from "./model.ts";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { k8sClusters, placements, type K8sStatus } from "../db/schema.ts";
import type { IncusAdminClient } from "../incus/admin-client.ts";
import { log } from "../lib/log.ts";
import { acquireLease, releaseLease } from "../reconcile/lease.ts";
import { defaultNetwork, ensureForward, findLb } from "./endpoint.ts";
import type { Kube, KubeObject } from "./kube.ts";

export interface K8sWorkerOptions {
  /** This replica's name in the lease. */
  holder: string;
  pollMs?: number;
  leaseMs?: number;
}

const LEASE = "kubernetes";
const API = "cluster.x-k8s.io/v1beta2";
/** Statuses the worker sets; `creating`, `provisioning` and `deleting` belong to a running job. */
const OWNED: K8sStatus[] = ["ready", "degraded", "error"];

type Condition = { type: string; status: string; message?: string };
const condition = (o: KubeObject | null | undefined, type: string) => ((o?.status as { conditions?: Condition[] } | undefined)?.conditions ?? []).find((c) => c.type === type);

/** What the management cluster says about one workload cluster. */
function assess(row: typeof k8sClusters.$inferSelect, cluster: KubeObject | null, machines: KubeObject[]) {
  const nodes = machines.length;
  const nodesReady = machines.filter((m) => condition(m, "Ready")?.status === "True").length;
  if (!cluster) return { status: "error" as const, statusMessage: "Its Cluster is missing from the management cluster", nodes, nodesReady };
  const cp = condition(cluster, "ControlPlaneAvailable");
  if (cp?.status !== "True") return { status: "degraded" as const, statusMessage: `Control plane not available${cp?.message ? `: ${cp.message}` : ""}`, nodes, nodesReady };
  const want = row.controlPlanes + row.workers;
  if (nodesReady < want) return { status: "degraded" as const, statusMessage: `${nodesReady} of ${want} nodes ready`, nodes, nodesReady };
  return { status: "ready" as const, statusMessage: "", nodes, nodesReady };
}

/**
 * The Kubernetes sync (P10): while holding its lease, reads each workload
 * cluster's Cluster and Machines into its row, and keeps the API forward
 * pointed at the load balancer's current address.
 */
export class K8sWorker {
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private running?: Promise<void>;
  private stopped = false;
  private wake?: () => void;

  constructor(
    private readonly deps: { db: Db; kube: Kube; clientFor: (clusterId: string) => Promise<IncusAdminClient> },
    private readonly opts: K8sWorkerOptions,
  ) {
    this.pollMs = opts.pollMs ?? 15_000;
    this.leaseMs = opts.leaseMs ?? 60_000;
  }

  /** One pass; public for tests. */
  async tick(): Promise<void> {
    const { db, kube } = this.deps;
    if (!(await acquireLease(db, LEASE, this.opts.holder, this.leaseMs))) return;
    const rows = await db
      .select({ row: k8sClusters, project: placements.project })
      .from(k8sClusters)
      .innerJoin(placements, and(eq(placements.tenantId, k8sClusters.tenantId), eq(placements.clusterId, k8sClusters.clusterId)))
      .where(inArray(k8sClusters.status, [...OWNED, "provisioning"]))
      .orderBy(k8sClusters.name);
    for (const { row, project } of rows) {
      if (this.stopped) return;
      try {
        const cluster = await kube.get(API, "Cluster", row.namespace, row.name);
        const machines = await kube.list(API, "Machine", row.namespace, `cluster.x-k8s.io/cluster-name=${row.name}`);
        const seen = assess(row, cluster, machines);
        const set = OWNED.includes(row.status) ? seen : { nodes: seen.nodes, nodesReady: seen.nodesReady };
        await db.update(k8sClusters).set({ ...set, syncedAt: new Date() }).where(eq(k8sClusters.id, row.id));
        if (cluster && OWNED.includes(row.status) && lbIsInstance(row.spec.loadBalancer)) await this.retarget(row, project);
      } catch (e) {
        log.warn("kubernetes sync failed", { cluster: row.name, error: (e as Error).message });
      }
    }
  }

  /** The load balancer may come back with another address (restart, evacuation): the forward follows it. */
  private async retarget(row: typeof k8sClusters.$inferSelect, project: string): Promise<void> {
    const client = await this.deps.clientFor(row.clusterId);
    const lb = await findLb(client, project, row.name, row.namespace);
    if (!lb?.address) return;
    const network = await defaultNetwork(client, project);
    const r = await ensureForward(client, { network, member: row.lbMember, host: row.endpointHost, port: row.endpointPort, target: lb.address, id: row.id });
    if (r !== "unchanged") log.info("kubernetes endpoint forward updated", { cluster: row.name, target: lb.address, change: r });
  }

  start(): void {
    if (this.running) return;
    this.stopped = false;
    this.running = (async () => {
      while (!this.stopped) {
        try {
          await this.tick();
        } catch (e) {
          log.error("kubernetes sync pass failed", { error: (e as Error).message });
        }
        if (this.stopped) break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.pollMs);
          this.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
      }
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.running;
    this.running = undefined;
    await releaseLease(this.deps.db, LEASE, this.opts.holder);
  }
}
