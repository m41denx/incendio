import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { clusterMembers, clusters, instances, metricsSamples, networks, storagePools } from "../db/schema.ts";

test("fleet tables apply and go with their cluster", async () => {
  const db = await testDb();
  const [c] = await db.insert(clusters).values({ name: "c1", url: "https://h:8443", fingerprint: "ab", serverCert: "pem", clientCert: "pem", clientKeyEnc: "v1.x.y" }).returning();
  const clusterId = c!.id;
  expect(c!.inventoryAt).toBeNull();
  expect(c!.inventoryError).toBe("");
  await db.insert(clusterMembers).values({ clusterId, name: "n1", url: "https://n1:8443", status: "Online", roles: ["database"], architecture: "x86_64", cpuThreads: 8, memoryTotal: 8e9, memoryUsed: 2e9 });
  const [i] = await db.insert(instances).values({ clusterId, project: "default", name: "web", type: "container", status: "Running", location: "n1", search: "web" }).returning();
  expect(i!.addresses).toEqual([]);
  await expect(Promise.resolve(db.insert(instances).values({ clusterId, project: "default", name: "web", type: "container", status: "Running", location: "n1", search: "web" }))).rejects.toThrow();
  await db.insert(storagePools).values({ clusterId, member: "n1", name: "default", driver: "zfs", status: "Created", spaceTotal: 1e11, spaceUsed: 1e10 });
  await db.insert(networks).values({ clusterId, project: "default", name: "incusbr0", type: "bridge", managed: true, status: "Created" });
  await db.insert(metricsSamples).values({ clusterId, kind: "instance", ref: i!.id, cpuCores: 0.5, memoryUsed: 1e8 });
  await db.delete(clusters).where(eq(clusters.id, clusterId));
  for (const t of [clusterMembers, instances, storagePools, networks, metricsSamples]) expect(await db.select().from(t)).toEqual([]);
});
