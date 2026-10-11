import { and, eq } from "drizzle-orm";
import { placements } from "../db/schema.ts";
import { ClusterError } from "../incus/admin-client.ts";
import { ApiError } from "../lib/errors.ts";
import type { JobHandler } from "../jobs/types.ts";
import { waitOp } from "../backups/backup-job.ts";
import { instancePath, refreshInventory } from "../mobility/migrate-job.ts";
import { projectUsage } from "../reconcile/projects.ts";
import { requestReconcile } from "../reconcile/requests.ts";

export const DEFAULT_IMAGE_SERVER = "https://images.linuxcontainers.org";

/** A self-service create (P9), placed and checked against the quota by the API. Sizes in bytes. */
export interface CreatePayload {
  tenantId: string;
  clusterId: string;
  project: string;
  name: string;
  image: string;
  type: "container" | "virtual-machine";
  cpu: number;
  memory: number;
  disk: number;
  start: boolean;
}

/**
 * Creates the instance in the tenant's project from the image server, with
 * its limits and a root disk of the requested size on the project's default
 * pool. Then records the project's new usage, so the next quota check sees
 * it, and asks for every cluster of the tenant to be reconciled, so the
 * quota is split again.
 */
export function createHandler(opts: { imageServer?: string } = {}): JobHandler {
  const server = opts.imageServer ?? DEFAULT_IMAGE_SERVER;
  return async (ctx) => {
    const p = ctx.job.payload as unknown as CreatePayload;
    const { client } = await ctx.clientFor(p.clusterId);
    const q = `?project=${encodeURIComponent(p.project)}`;
    try {
      await client.request("GET", instancePath(p.project, p.name));
      throw new ApiError(409, "conflict", `An instance named "${p.name}" already exists in ${p.project}`);
    } catch (e) {
      if (!(e instanceof ClusterError && e.clusterStatus === 404)) throw e;
    }
    const profile = (await client.request<{ devices?: Record<string, Record<string, string>> }>("GET", `/1.0/profiles/default${q}`)).metadata;
    const root = Object.values(profile.devices ?? {}).find((d) => d.type === "disk" && d.path === "/");
    if (!root?.pool) throw new ApiError(409, "conflict", `The default profile of ${p.project} has no root disk to size`);

    await ctx.progress({ stage: "creating", message: `${p.name} from ${p.image}` });
    const r = await client.request("POST", `/1.0/instances${q}`, {
      name: p.name,
      type: p.type,
      source: { type: "image", alias: p.image, server, protocol: "simplestreams" },
      config: { "limits.cpu": String(p.cpu), "limits.memory": String(p.memory) },
      devices: { root: { type: "disk", path: "/", pool: root.pool, size: String(p.disk) } },
      start: p.start,
    });
    if (r.type === "async" && r.operation) await waitOp(client, r.operation, ctx.signal);

    const usage = await projectUsage(client, p.project).catch(() => null);
    if (usage) await ctx.db.update(placements).set({ usage }).where(and(eq(placements.tenantId, p.tenantId), eq(placements.clusterId, p.clusterId)));
    await requestReconcile(ctx.db, { tenant: p.tenantId });
    await refreshInventory(ctx.db, [p.clusterId]);
    return { clusterId: p.clusterId, project: p.project, name: p.name };
  };
}
