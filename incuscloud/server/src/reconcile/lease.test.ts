import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { acquireLease, releaseLease } from "./lease.ts";

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

test("one holder at a time; the holder renews", async () => {
  expect(await acquireLease(db, "reconciler", "a", 10_000)).toBe(true);
  expect(await acquireLease(db, "reconciler", "b", 10_000)).toBe(false);
  expect(await acquireLease(db, "reconciler", "a", 10_000)).toBe(true);
  expect(await acquireLease(db, "other", "b", 10_000)).toBe(true);
});

test("an expired lease is taken over", async () => {
  expect(await acquireLease(db, "reconciler", "a", 50)).toBe(true);
  await Bun.sleep(120);
  expect(await acquireLease(db, "reconciler", "b", 10_000)).toBe(true);
  expect(await acquireLease(db, "reconciler", "a", 10_000)).toBe(false);
});

test("released leases are free at once; only the holder releases", async () => {
  await acquireLease(db, "reconciler", "a", 10_000);
  await releaseLease(db, "reconciler", "b");
  expect(await acquireLease(db, "reconciler", "b", 10_000)).toBe(false);
  await releaseLease(db, "reconciler", "a");
  expect(await acquireLease(db, "reconciler", "b", 10_000)).toBe(true);
});
