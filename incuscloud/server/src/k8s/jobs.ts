import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { aclEntries, jobs, k8sClusters, placements, tenants } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { entriesUnder } from "../acl/entries.ts";
import type { JobContext, JobHandler } from "../jobs/types.ts";
import { ApiError } from "../lib/errors.ts";
import { ensureCredentials, revokeUnlessUsed } from "./credentials.ts";
import { defaultNetwork, ensureForward, findLb, removeForward, removeLeftovers } from "./endpoint.ts";
import { log } from "../lib/log.ts";
import type { Kube, KubeObject } from "./kube.ts";
import { lbIsInstance } from "./model.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { installMetalLB, kubeFromKubeconfig, metallbObjects, workloadKubeconfig, METALLB_MANIFEST_URL } from "./metallb.ts";
import { METALLB_NAMESPACE, METALLB_POOL } from "@incendio/k8s/src/lib/metallb.ts";
import { classBundle, clusterManifest, tenantBundle } from "./manifests.ts";

/** What the k8s-create and k8s-delete jobs carry: the row; everything else is read from it. */
export interface K8sJobPayload {
  k8sId: string;
}

export interface K8sJobOptions {
  kube: Kube;
  /** How long a job waits for CAPI and CAPN in all. */
  deadlineMs?: number;
  /** Between looks at what the controllers did. */
  pollMs?: number;
  /** Tests replace it to play the controllers. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Opens a workload cluster's API from its admin kubeconfig (MetalLB); tests replace it. */
  workloadKube?: (kubeconfig: string) => Kube;
  /** MetalLB's native manifest (MetalLB); tests replace it. */
  metallbManifest?: () => Promise<string>;
}

const DEADLINE_MS = 30 * 60_000;
const POLL_MS = 10_000;
const CLUSTER = ["cluster.x-k8s.io/v1beta2", "Cluster"] as const;

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/** The row, its tenant and its project on the Incus cluster. */
async function load(ctx: JobContext) {
  const { k8sId } = ctx.job.payload as unknown as K8sJobPayload;
  const [row] = await ctx.db.select().from(k8sClusters).where(eq(k8sClusters.id, k8sId));
  if (!row) throw new ApiError(404, "not_found", "Kubernetes cluster not found");
  const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, row.tenantId));
  const [placement] = await ctx.db.select().from(placements).where(and(eq(placements.tenantId, row.tenantId), eq(placements.clusterId, row.clusterId)));
  if (!tenant || !placement) throw new ApiError(409, "conflict", "The tenant is no longer placed on that cluster");
  const { client, row: cluster } = await ctx.clientFor(row.clusterId);
  return { row, tenant, project: placement.project, client, cluster };
}

const endpointUrl = (host: string, port: number) => `https://${host.includes(":") ? `[${host}]` : host}:${port}`;

/** Why the control plane is not available yet: the condition's message, if any. */
const controlPlane = (obj: KubeObject | null) => {
  const conditions = ((obj?.status as { conditions?: Array<{ type: string; status: string; message?: string }> })?.conditions ?? []);
  const c = conditions.find((x) => x.type === "ControlPlaneAvailable");
  return { available: c?.status === "True", message: c?.message ?? "" };
};

function waiter(ctx: JobContext, o: K8sJobOptions) {
  const deadline = Date.now() + (o.deadlineMs ?? DEADLINE_MS);
  const sleep = o.sleep ?? abortableSleep;
  /** Looks until `check` gives a value, or fails with `timeout()` once the job's deadline has passed. */
  return async <T>(check: () => Promise<T | null | undefined>, timeout: () => string): Promise<T> => {
    for (;;) {
      ctx.signal.throwIfAborted();
      const v = await check();
      if (v !== null && v !== undefined) return v;
      if (Date.now() >= deadline) throw new ApiError(504, "timeout", timeout());
      await sleep(o.pollMs ?? POLL_MS, ctx.signal);
    }
  };
}

/**
 * Creates a workload cluster (spec D13): the tenant's namespace, CAPN's
 * restricted credentials, the Cluster on its preset endpoint; then, once
 * CAPN's load balancer has an address, the forward to it; then waits for
 * the control plane. A failure marks the cluster as failed.
 */
export function k8sCreateHandler(o: K8sJobOptions): JobHandler {
  const { kube } = o;
  return async (ctx) => {
    const { row, tenant, project, client, cluster } = await load(ctx);
    const wait = waiter(ctx, o);
    try {
      // A tenant an operator just placed here: its project comes first.
      const placement = async () =>
        (await ctx.db.select({ status: placements.status, message: placements.statusMessage }).from(placements).where(and(eq(placements.tenantId, row.tenantId), eq(placements.clusterId, row.clusterId))))[0];
      let pl = await placement();
      if (pl?.status !== "ready") {
        await ctx.progress({ stage: "placement", message: `waiting for ${project} on ${cluster.name}` });
        await wait(
          async () => ((pl = await placement())?.status === "ready" ? true : null),
          () => `The tenant's project ${project} on ${cluster.name} is not ready (${pl?.status ?? "removed"}${pl?.message ? `: ${pl.message}` : ""})`,
        );
      }

      await ctx.progress({ stage: "namespace", message: row.namespace });
      for (const obj of [...classBundle(), ...tenantBundle(tenant.slug)]) await kube.apply(obj);

      await ctx.progress({ stage: "credentials", message: `a certificate for ${project} on ${cluster.name}` });
      const { secretName } = await ensureCredentials({ db: ctx.db, kube, client }, { tenant, cluster, project });

      await ctx.progress({ stage: "cluster", message: `${row.name} on ${endpointUrl(row.endpointHost, row.endpointPort)}` });
      await kube.apply(clusterManifest({ ...row, secretName }));
      await ctx.db.update(k8sClusters).set({ status: "provisioning" }).where(eq(k8sClusters.id, row.id));

      // kube-vip and OVN: the API is at their own address; only an instance load balancer is forwarded to.
      if (lbIsInstance(row.spec.loadBalancer)) {
        await ctx.progress({ stage: "load-balancer", message: "waiting for its address" });
        const lb = await wait(
          async () => {
            const found = await findLb(client, project, row.name, row.namespace);
            return found?.address ? { ...found, address: found.address } : null;
          },
          () => `The load balancer of ${row.name} did not get an address in time`,
        );

        await ctx.progress({ stage: "forward", message: `${row.endpointHost}:${row.endpointPort} to ${lb.address}:6443` });
        const network = await defaultNetwork(client, project);
        await ensureForward(client, { network, member: row.lbMember, host: row.endpointHost, port: row.endpointPort, target: lb.address, id: row.id });
      }

      await ctx.progress({ stage: "control-plane", message: "waiting until it is available" });
      let why = "";
      await wait(
        async () => {
          const cp = controlPlane(await kube.get(...CLUSTER, row.namespace, row.name));
          why = cp.message;
          return cp.available || null;
        },
        () => `The control plane of ${row.name} did not become available in time${why ? ` (${why})` : ""}`,
      );
      await ctx.db.update(k8sClusters).set({ status: "ready", statusMessage: "" }).where(eq(k8sClusters.id, row.id));
      // MetalLB goes in once there is a cluster to put it in: its own job, so a failure there is not the create's.
      if (row.spec.metallb) {
        await enqueueJob(ctx.db, { type: "k8s-metallb", payload: { k8sId: row.id, name: row.name }, actor: { type: "system", id: "k8s-create" }, tenantId: row.tenantId, clusterIds: [row.clusterId] });
      }
      return { id: row.id, endpoint: endpointUrl(row.endpointHost, row.endpointPort) };
    } catch (e) {
      // Stopped by a delete: the row is the delete's now.
      await ctx.db
        .update(k8sClusters)
        .set({ status: "error", statusMessage: (e as Error).message.slice(0, 500) })
        .where(and(eq(k8sClusters.id, row.id), ne(k8sClusters.status, "deleting")));
      throw e;
    }
  };
}

/**
 * Deletes a workload cluster: the Cluster (CAPN removes its instances),
 * then our forward port, then the credentials when no other cluster of the
 * tenant uses them, then the row. Until it is done the row stays `deleting`.
 */
export function k8sDeleteHandler(o: K8sJobOptions): JobHandler {
  const { kube } = o;
  return async (ctx) => {
    const { row, tenant, project, client, cluster } = await load(ctx);
    const wait = waiter(ctx, o);
    await ctx.db.update(k8sClusters).set({ status: "deleting" }).where(eq(k8sClusters.id, row.id));

    // A create still running was asked to stop; it must end before its forward and credentials go.
    await wait(
      async () => {
        const running = await ctx.db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.type, "k8s-create"), inArray(jobs.state, ["queued", "running"]), sql`${jobs.payload}->>'k8sId' = ${row.id}`));
        return running.length ? null : true;
      },
      () => `The create of ${row.name} did not stop in time`,
    );

    await ctx.progress({ stage: "cluster", message: `deleting ${row.name} and its nodes` });
    await kube.delete(...CLUSTER, row.namespace, row.name);
    await wait(async () => ((await kube.get(...CLUSTER, row.namespace, row.name)) ? null : true), () => `${row.name} was not removed in time`);

    await ctx.progress({ stage: "leftovers", message: `instances of ${row.name} left in ${project}` });
    const leftovers = await removeLeftovers(client, project, row.name, row.namespace);
    if (leftovers.length) log.warn("kubernetes leftovers removed", { cluster: row.name, project, instances: leftovers });

    if (lbIsInstance(row.spec.loadBalancer)) {
      await ctx.progress({ stage: "forward", message: `${row.endpointHost}:${row.endpointPort}` });
      const network = await defaultNetwork(client, project);
      await removeForward(client, { network, member: row.lbMember, host: row.endpointHost, port: row.endpointPort, target: "", id: row.id });
    }

    await ctx.progress({ stage: "credentials", message: `revoking the certificate on ${cluster.name} if no other cluster uses it` });
    await revokeUnlessUsed({ db: ctx.db, kube, client }, { tenant, cluster, except: row.id });
    await deleteK8sRow(ctx.db, row.id);
    // The tenant's last Kubernetes cluster anywhere: its namespace (flannel's set) goes too.
    const [left] = await ctx.db.select({ id: k8sClusters.id }).from(k8sClusters).where(eq(k8sClusters.tenantId, row.tenantId)).limit(1);
    if (!left) await kube.delete("v1", "Namespace", undefined, row.namespace);
    return { id: row.id };
  };
}

/**
 * Puts the cluster's MetalLB in line with its spec: installs (or updates)
 * MetalLB and its pool when it has addresses; removes the pool (MetalLB
 * itself stays) when it has none.
 */
export function k8sMetallbHandler(o: K8sJobOptions): JobHandler {
  const { kube } = o;
  const workloadKube = o.workloadKube ?? kubeFromKubeconfig;
  const manifest = o.metallbManifest ?? (() => fetchManifest(METALLB_MANIFEST_URL));
  return async (ctx) => {
    const { row } = await load(ctx);
    const text = await workloadKubeconfig(kube, row.namespace, row.name);
    if (!text) throw new Error(`The kubeconfig of ${row.name} is not available yet`);
    const workload = workloadKube(text);
    const addresses = row.spec.metallb?.addresses ?? [];
    if (!addresses.length) {
      await ctx.progress({ stage: "pool", message: "removing the address pool" });
      await workload.delete("metallb.io/v1beta1", "L2Advertisement", METALLB_NAMESPACE, METALLB_POOL);
      await workload.delete("metallb.io/v1beta1", "IPAddressPool", METALLB_NAMESPACE, METALLB_POOL);
      return { id: row.id, addresses };
    }
    await ctx.progress({ stage: "metallb", message: `installing MetalLB with ${addresses.join(", ")}` });
    await installMetalLB(workload, metallbObjects(await manifest(), addresses), { deadlineMs: o.deadlineMs, sleep: o.sleep ? (ms) => o.sleep!(ms, ctx.signal) : undefined });
    return { id: row.id, addresses };
  };
}

async function fetchManifest(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`MetalLB's manifest (${url}): HTTP ${r.status}`);
  return r.text();
}

/** Removes a Kubernetes cluster's row and the permission entries on it: a later one of the same name starts clean. */
export async function deleteK8sRow(db: Db, id: string): Promise<void> {
  const [row] = await db.select({ name: k8sClusters.name, slug: tenants.slug }).from(k8sClusters).innerJoin(tenants, eq(tenants.id, k8sClusters.tenantId)).where(eq(k8sClusters.id, id));
  if (!row) return;
  await db.transaction(async (tx) => {
    await tx.delete(k8sClusters).where(eq(k8sClusters.id, id));
    await tx.delete(aclEntries).where(entriesUnder(`/tenants/${row.slug}/kubernetes/${row.name}`));
  });
}
