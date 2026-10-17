import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterMembers, clusters, instances, metricsSamples, networks, storagePools } from "../db/schema.ts";
import type { InstanceSnapshot, Snapshot } from "./collect.ts";

type Prev = { cpuNs: number | null; netRx: number | null; netTx: number | null; seenAt: Date };

/** Per-second rate of a counter since the previous pass; null when unknown or the counter went backwards (restart). */
function rate(now: number | null, prev: number | null | undefined, seconds: number, scale = 1): number | null {
  if (now == null || prev == null || seconds <= 0 || now < prev) return null;
  return (now - prev) / seconds / scale;
}

export const searchText = (clusterName: string, i: InstanceSnapshot) =>
  [i.name, i.project, clusterName, i.location, i.description, i.imageOs, i.imageRelease, i.type, i.status, ...i.addresses]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const CHUNK = 500; // rows per insert, well under Postgres's parameter limit

/**
 * Stores one inventory pass: instances upserted (with rates from the previous
 * pass), whatever disappeared removed, one metrics sample per running instance
 * and per member, samples older than the retention pruned.
 */
export async function applySnapshot(db: Db, clusterId: string, clusterName: string, snap: Snapshot, now: Date, retentionMs: number): Promise<{ instances: number }> {
  return db.transaction(async (tx) => {
    const prev = new Map<string, Prev>(
      (await tx.select({ project: instances.project, name: instances.name, cpuNs: instances.cpuNs, netRx: instances.netRx, netTx: instances.netTx, seenAt: instances.seenAt }).from(instances).where(eq(instances.clusterId, clusterId))).map(
        (r) => [`${r.project}/${r.name}`, r],
      ),
    );

    const rows = snap.instances.map((i) => {
      const p = prev.get(`${i.project}/${i.name}`);
      const seconds = p ? (now.getTime() - p.seenAt.getTime()) / 1000 : 0;
      return {
        clusterId,
        project: i.project,
        name: i.name,
        type: i.type,
        status: i.status,
        location: i.location,
        description: i.description,
        architecture: i.architecture,
        createdAtIncus: i.createdAt ? new Date(i.createdAt) : null,
        imageOs: i.imageOs,
        imageRelease: i.imageRelease,
        limitsCpu: i.limitsCpu,
        limitsMemory: i.limitsMemory,
        cpuNs: i.cpuNs,
        memoryUsed: i.memoryUsed,
        memoryTotal: i.memoryTotal,
        diskUsed: i.diskUsed,
        netRx: i.netRx,
        netTx: i.netTx,
        cpuCores: rate(i.cpuNs, p?.cpuNs, seconds, 1e9),
        netRxBps: rate(i.netRx, p?.netRx, seconds),
        netTxBps: rate(i.netTx, p?.netTx, seconds),
        addresses: i.addresses,
        hints: i.hints,
        snapshots: i.snapshots ?? 0,
        search: searchText(clusterName, i),
        seenAt: now,
      };
    });

    const kept: Array<{ id: string; status: string; cpuCores: number | null; memoryUsed: number | null; netRxBps: number | null; netTxBps: number | null }> = [];
    for (let n = 0; n < rows.length; n += CHUNK) {
      const chunk = rows.slice(n, n + CHUNK);
      const set = Object.fromEntries(
        Object.keys(chunk[0]!)
          .filter((k) => k !== "clusterId" && k !== "project" && k !== "name")
          .map((k) => {
            const col = instances[k as keyof typeof instances.$inferInsert];
            return [k, sql.raw(`excluded."${(col as { name: string }).name}"`)];
          }),
      );
      kept.push(
        ...(await tx
          .insert(instances)
          .values(chunk)
          .onConflictDoUpdate({ target: [instances.clusterId, instances.project, instances.name], set })
          .returning({ id: instances.id, status: instances.status, cpuCores: instances.cpuCores, memoryUsed: instances.memoryUsed, netRxBps: instances.netRxBps, netTxBps: instances.netTxBps })),
      );
    }
    const keptIds = kept.map((k) => k.id);
    await tx.delete(instances).where(keptIds.length ? and(eq(instances.clusterId, clusterId), notInArray(instances.id, keptIds)) : eq(instances.clusterId, clusterId));

    // Members, pools and networks are small: replace them.
    await tx.delete(clusterMembers).where(eq(clusterMembers.clusterId, clusterId));
    if (snap.members.length) await tx.insert(clusterMembers).values(snap.members.map((m) => ({ clusterId, ...m, updatedAt: now })));
    await tx.delete(storagePools).where(eq(storagePools.clusterId, clusterId));
    if (snap.pools.length) await tx.insert(storagePools).values(snap.pools.map((p) => ({ clusterId, ...p })));
    await tx.delete(networks).where(eq(networks.clusterId, clusterId));
    if (snap.networks.length) await tx.insert(networks).values(snap.networks.map((x) => ({ clusterId, ...x })));

    const samples = [
      ...kept
        .filter((k) => k.status === "Running")
        .map((k) => ({ at: now, clusterId, kind: "instance" as const, ref: k.id, cpuCores: k.cpuCores, memoryUsed: k.memoryUsed, netRxBps: k.netRxBps, netTxBps: k.netTxBps })),
      ...snap.members.map((m) => ({ at: now, clusterId, kind: "member" as const, ref: m.name, memoryUsed: m.memoryUsed, load1: m.load1 })),
    ];
    for (let n = 0; n < samples.length; n += CHUNK) await tx.insert(metricsSamples).values(samples.slice(n, n + CHUNK));
    await tx.delete(metricsSamples).where(lt(metricsSamples.at, new Date(now.getTime() - retentionMs)));

    await tx.update(clusters).set({ inventoryAt: now, inventoryError: "" }).where(eq(clusters.id, clusterId));
    return { instances: kept.length };
  });
}
