import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { clusters } from "../db/schema.ts";
import { ClusterCache } from "./clusters-cache.ts";

test("looks clusters up by name, caches them, and forgets on invalidate", async () => {
  const db = await testDb();
  await db.insert(clusters).values({ name: "c1", url: "https://x:8443", fingerprint: "ab", serverCert: "", clientCert: "", clientKeyEnc: "" });
  const cache = new ClusterCache(db, 60_000);
  expect((await cache.get("c1"))?.url).toBe("https://x:8443");
  expect(await cache.get("nope")).toBeNull();
  await db.update(clusters).set({ url: "https://y:8443" }).where(eq(clusters.name, "c1"));
  expect((await cache.get("c1"))?.url).toBe("https://x:8443");
  cache.invalidate("c1");
  expect((await cache.get("c1"))?.url).toBe("https://y:8443");
  await db.delete(clusters);
  cache.invalidate();
  expect(await cache.get("c1")).toBeNull();
});

test("entries expire after the TTL", async () => {
  const db = await testDb();
  const cache = new ClusterCache(db, 20);
  expect(await cache.get("c1")).toBeNull();
  await db.insert(clusters).values({ name: "c1", url: "https://x:8443", fingerprint: "ab", serverCert: "", clientCert: "", clientKeyEnc: "" });
  await Bun.sleep(30);
  expect((await cache.get("c1"))?.name).toBe("c1");
});
