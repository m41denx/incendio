import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusters, instanceOwners, instances, placements, tenantMembers, tenants, users } from "../db/schema.ts";
import { backfillOwners, forgetOwned, ownerOf, recordOwner, renameOwned } from "./owners.ts";

let db: Db;
let c: string;
let acme: string;
const key = (name: string, project = "acme") => ({ clusterId: c, project, name });
const mkUser = async (email: string) => (await db.insert(users).values({ email, name: email }).returning())[0]!.id;
const instance = (name: string, project = "acme") => db.insert(instances).values({ clusterId: c, project, name, type: "container", status: "Running", search: name });

beforeEach(async () => {
  db = await testDb();
  c = (await db.insert(clusters).values({ name: "c", url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
  acme = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning())[0]!.id;
  await db.insert(placements).values({ tenantId: acme, clusterId: c, project: "acme" });
});

test("backfill gives unowned instances to the tenant's first owner; a tenant without owners leaves them unowned", async () => {
  await instance("web");
  await instance("other", "default");
  expect(await backfillOwners(db, c)).toBe(0);
  expect(await ownerOf(db, key("web"))).toBeNull();
  const first = await mkUser("first@x");
  const second = await mkUser("second@x");
  await db.insert(tenantMembers).values({ tenantId: acme, userId: first, role: "owner", createdAt: new Date("2026-01-01") });
  await db.insert(tenantMembers).values({ tenantId: acme, userId: second, role: "owner", createdAt: new Date("2026-02-01") });
  expect(await backfillOwners(db, c)).toBe(1);
  expect(await ownerOf(db, key("web"))).toBe(`user:${first}`);
  // Not a tenant's project: nobody's.
  expect(await ownerOf(db, key("other", "default"))).toBeNull();
  expect(await backfillOwners(db, c)).toBe(0);
});

test("an event owner is not overwritten by backfill; a job's owner overwrites both", async () => {
  const a = await mkUser("a@x");
  const b = await mkUser("b@x");
  await recordOwner(db, key("web"), `user:${a}`, "backfill");
  await recordOwner(db, key("web"), `user:${b}`, "event");
  expect(await ownerOf(db, key("web"))).toBe(`user:${b}`);
  await recordOwner(db, key("web"), `user:${a}`, "backfill");
  expect(await ownerOf(db, key("web"))).toBe(`user:${b}`);
  await recordOwner(db, key("web"), `user:${a}`, "incuscloud");
  expect(await ownerOf(db, key("web"))).toBe(`user:${a}`);
  await recordOwner(db, key("web"), `user:${b}`, "event");
  expect(await ownerOf(db, key("web"))).toBe(`user:${a}`);
});

test("rename re-keys, forget deletes, a deleted owner leaves the instance unowned", async () => {
  const a = await mkUser("a@x");
  await recordOwner(db, key("web"), `user:${a}`, "event");
  await renameOwned(db, key("web"), key("web2"));
  expect([await ownerOf(db, key("web")), await ownerOf(db, key("web2"))]).toEqual([null, `user:${a}`]);
  await db.delete(users);
  expect(await ownerOf(db, key("web2"))).toBeNull();
  expect((await db.select().from(instanceOwners)).length).toBe(1);
  await forgetOwned(db, key("web2"));
  expect(await db.select().from(instanceOwners)).toEqual([]);
});
