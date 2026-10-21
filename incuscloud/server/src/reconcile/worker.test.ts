import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, placements, tenants } from "../db/schema.ts";
import { acquireLease } from "./lease.ts";
import { requestReconcile } from "./requests.ts";
import { Worker } from "./worker.ts";

let db: Db;
let seen: string[];
let ids: Record<string, string>;
const reconcile = async (_deps: unknown, id: string) => {
  seen.push(id);
  await db.update(clusters).set({ reconciledAt: new Date() }).where(eq(clusters.id, id));
  return { status: "ready" as const, message: "" };
};
const worker = (holder = "w1", extra: Partial<ConstructorParameters<typeof Worker>[1]> = {}) => new Worker({ db } as never, { holder, intervalMs: 60_000, reconcile, ...extra });
const cluster = async (name: string, status = "ready") =>
  (await db.insert(clusters).values({ name, url: "https://x", fingerprint: "f", serverCert: "c", clientCert: "c", clientKeyEnc: "k", status }).returning())[0]!.id;
const names = () => seen.map((id) => Object.keys(ids).find((k) => ids[k] === id)).sort();

beforeEach(async () => {
  db = await testDb();
  seen = [];
  ids = { c1: await cluster("c1"), c2: await cluster("c2"), off: await cluster("off", "disabled") };
});

test("never-reconciled clusters are reconciled; disabled ones are not; then nothing is due", async () => {
  const w = worker();
  await w.tick();
  expect(names()).toEqual(["c1", "c2"]);
  seen = [];
  await w.tick();
  expect(seen).toEqual([]);
});

test("requests are served and cleared", async () => {
  const w = worker();
  await w.tick();
  seen = [];
  await requestReconcile(db, [ids.c2!]);
  await w.tick();
  expect(names()).toEqual(["c2"]);
  seen = [];
  await w.tick();
  expect(seen).toEqual([]);
});

test("'all' and tenant requests reach the right clusters", async () => {
  const w = worker();
  await w.tick();
  const [t] = await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning();
  await db.insert(placements).values({ tenantId: t!.id, clusterId: ids.c1!, project: "acme" });
  seen = [];
  await requestReconcile(db, { tenant: t!.id });
  await w.tick();
  expect(names()).toEqual(["c1"]);
  seen = [];
  await requestReconcile(db, "all");
  await w.tick();
  expect(names()).toEqual(["c1", "c2"]);
});

test("a request made during a pass is kept for the next one", async () => {
  const w = new Worker({ db } as never, {
    holder: "w1",
    reconcile: async (d, id) => {
      const r = await reconcile(d, id);
      if (seen.length === 1) await requestReconcile(db, [id]);
      return r;
    },
  });
  await w.tick();
  const first = seen[0]!;
  seen = [];
  await w.tick();
  expect(seen).toEqual([first]);
});

test("clusters are reconciled again once the interval has passed", async () => {
  const w = worker("w1", { intervalMs: 50 });
  await w.tick();
  seen = [];
  await Bun.sleep(80);
  await w.tick();
  expect(names()).toEqual(["c1", "c2"]);
});

test("only the lease holder works", async () => {
  expect(await acquireLease(db, "reconciler", "other", 60_000)).toBe(true);
  await worker("w1").tick();
  expect(seen).toEqual([]);
});

test("a failing cluster does not stop the pass", async () => {
  const w = new Worker({ db } as never, {
    holder: "w1",
    reconcile: async (d, id) => {
      if (id === ids.c1) throw new Error("boom");
      return reconcile(d, id);
    },
  });
  await w.tick();
  expect(names()).toEqual(["c2"]);
});

test("start runs passes until stop, which releases the lease", async () => {
  const w = worker("w1", { pollMs: 10 });
  w.start();
  await Bun.sleep(100);
  await w.stop();
  expect(names()).toEqual(["c1", "c2"]);
  expect(await acquireLease(db, "reconciler", "w2", 60_000)).toBe(true);
});
