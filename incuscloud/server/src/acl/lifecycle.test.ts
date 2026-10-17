import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { serviceAccounts, users } from "../db/schema.ts";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { enrollCluster } from "../clusters/enroll.ts";
import { Lifecycle, onLifecycle } from "./lifecycle.ts";
import { ownerOf, recordOwner } from "./owners.ts";

// Events as cluster-b sent them (dev stack, 2026-10-17); the requestor is substituted.
const fixture = (action: string, requestor: string, protocol = "oidc") => {
  const e = JSON.parse(readFileSync(new URL(`../test/fixtures/lifecycle/${action}.json`, import.meta.url), "utf8"));
  e.metadata.requestor.username = requestor;
  e.metadata.requestor.protocol = protocol;
  return e;
};
const secretKey = Buffer.alloc(32, 4);
let fake: FakeIncus;
let db: Db;
let c: string;
let u: string;
let listener: Lifecycle | undefined;
const until = async (f: () => Promise<boolean> | boolean, ms = 3000, label = "") => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error(`timed out ${label}`);
    await Bun.sleep(20);
  }
};

beforeAll(async () => {
  fake = await new FakeIncus().start();
});
afterAll(() => fake.stop());
beforeEach(async () => {
  db = await testDb();
  c = (await enrollCluster({ db, secretKey }, { name: "c1", token: fake.token() })).id;
  u = (await db.insert(users).values({ email: "u@x", name: "u" }).returning())[0]!.id;
});
afterEach(() => listener?.stop());

const key = (name: string) => ({ clusterId: c, project: "kspike", name });

test("an oidc create records the requestor and asks for a reconcile", async () => {
  expect(await onLifecycle(db, c, fixture("instance-created", u))).toBe(true);
  expect(await ownerOf(db, key("evt-probe"))).toBe(`user:${u}`);
});

test("a service account's clientId maps to the account", async () => {
  const [sa] = await db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-ci" }).returning();
  await onLifecycle(db, c, fixture("instance-created", "sa-ci"));
  expect(await ownerOf(db, key("evt-probe"))).toBe(`service:${sa!.id}`);
});

test("admin-certificate and unknown requestors are left to the jobs and the backfill", async () => {
  expect(await onLifecycle(db, c, fixture("instance-created", "0123abcd", "tls"))).toBe(false);
  expect(await onLifecycle(db, c, fixture("instance-created", "nobody-we-know"))).toBe(false);
  expect(await ownerOf(db, key("evt-probe"))).toBeNull();
});

test("rename re-keys, delete forgets", async () => {
  await recordOwner(db, key("evt-probe"), `user:${u}`, "event");
  expect(await onLifecycle(db, c, fixture("instance-renamed", u))).toBe(true);
  expect([await ownerOf(db, key("evt-probe")), await ownerOf(db, key("evt-probe2"))]).toEqual([null, `user:${u}`]);
  expect(await onLifecycle(db, c, fixture("instance-deleted", u))).toBe(true);
  expect(await ownerOf(db, key("evt-probe2"))).toBeNull();
});

test("the listener follows the cluster's events, asks for reconciles, and reconnects after a drop", async () => {
  const changed: string[] = [];
  listener = new Lifecycle({ db, secretKey, onOwnerChange: async (id) => void changed.push(id) }, { refreshMs: 50, minBackoffMs: 20 });
  listener.start();
  await until(() => fake.eventSockets.length === 1, 3000, "first socket");
  expect(fake.upgrades.at(-1)!.url).toBe("/1.0/events?type=lifecycle&all-projects=true");
  fake.emit(fixture("instance-created", u));
  await until(async () => (await ownerOf(db, key("evt-probe"))) === `user:${u}`, 3000, "created");
  expect(changed).toEqual([c]);
  for (const s of fake.eventSockets) s.terminate();
  await until(() => fake.eventSockets.length === 0, 3000, "dropped");
  await until(() => fake.eventSockets.length === 1, 3000, "reconnected");
  fake.emit(fixture("instance-renamed", u));
  await until(async () => (await ownerOf(db, key("evt-probe2"))) === `user:${u}`, 3000, "renamed");
}, 15000);
