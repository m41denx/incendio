import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, instances } from "../db/schema.ts";

/** Entries on `path` and below it. */
export const entriesUnder = (path: string): SQL => or(eq(aclEntries.path, path), sql`starts_with(${aclEntries.path}, ${`${path}/`})`)!;

/** Moves the entries on `from` and below it to `to` (a renamed object). */
export async function moveEntries(db: Db, from: string, to: string): Promise<void> {
  await db
    .update(aclEntries)
    .set({ path: sql`${to} || substr(${aclEntries.path}, ${from.length + 1})` })
    .where(entriesUnder(from));
}

/** Deletes entries on this cluster's instances that the inventory no longer has (their delete event was missed). */
export async function sweepInstanceEntries(db: Db, clusterId: string, clusterName: string): Promise<number> {
  const prefix = `/clusters/${clusterName}/projects/`;
  const rows = await db.select({ id: aclEntries.id, path: aclEntries.path }).from(aclEntries).where(sql`starts_with(${aclEntries.path}, ${prefix}) and ${aclEntries.path} like '%/instances/%'`);
  if (!rows.length) return 0;
  const present = new Set((await db.select({ project: instances.project, name: instances.name }).from(instances).where(eq(instances.clusterId, clusterId))).map((i) => `${prefix}${i.project}/instances/${i.name}`));
  const gone = rows.filter((r) => !present.has(r.path)).map((r) => r.id);
  if (gone.length) await db.delete(aclEntries).where(inArray(aclEntries.id, gone));
  return gone.length;
}
