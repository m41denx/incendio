import { expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import { clusters, gatewayRequests } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { RequestLog } from "./request-log.ts";
import type { GatewayRequest } from "./handler.ts";

async function setup() {
  const db = await testDb();
  const [cluster] = await db.insert(clusters).values({ name: "c1", url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning();
  const req = (o: Partial<GatewayRequest> = {}): GatewayRequest => ({ cluster: cluster!, principal: { kind: "user", id: "u1", name: "U", token: "t" }, method: "GET", path: "/1.0/instances?recursion=1", status: 200, bytesIn: 0, bytesOut: 10, durationMs: 3, ip: "1.2.3.4", upgrade: false, ...o });
  return { db, cluster: cluster!, req };
}

test("writes are always kept; reads only as sampled; upgrades always", async () => {
  const { db, req } = await setup();
  const log = new RequestLog(db, { sampleReads: 0, flushMs: 60_000 });
  log.record(req());
  log.record(req({ method: "POST", path: "/1.0/instances" }));
  log.record(req({ upgrade: true, path: "/1.0/operations/x/websocket?secret=s" }));
  await log.stop();
  const rows = await db.select().from(gatewayRequests);
  expect(rows.map((r) => r.method + " " + r.path)).toEqual(["POST /1.0/instances", "GET /1.0/operations/x/websocket"]);
  expect(rows[0]).toMatchObject({ actorType: "user", actorId: "u1", status: 200, ip: "1.2.3.4" });
});

test("sampleReads 1 keeps reads; queries (secrets) are never stored; long paths are cut", async () => {
  const { db, req } = await setup();
  const log = new RequestLog(db, { sampleReads: 1, flushMs: 60_000 });
  log.record(req());
  log.record(req({ path: `/1.0/${"x".repeat(1000)}` }));
  log.record(req({ principal: null, path: "/1.0" }));
  await log.flush();
  const rows = await db.select().from(gatewayRequests);
  expect(rows[0]!.path).toBe("/1.0/instances");
  expect(rows[1]!.path.length).toBe(512);
  expect(rows[2]).toMatchObject({ actorType: "anonymous", actorId: "" });
  await log.stop();
});

test("batches are flushed on a timer and when full", async () => {
  const { db, req } = await setup();
  const log = new RequestLog(db, { sampleReads: 1, flushMs: 20, maxBatch: 2 });
  log.record(req());
  log.record(req());
  await Bun.sleep(5);
  expect((await db.select().from(gatewayRequests)).length).toBe(2); // full batch
  log.record(req());
  await Bun.sleep(60);
  expect((await db.select().from(gatewayRequests)).length).toBe(3); // timer
  await log.stop();
});

test("a failing database never throws at the gateway", async () => {
  const broken = { insert: () => ({ values: async () => { throw new Error("db down"); } }) } as unknown as Db;
  const { req } = await setup();
  const log = new RequestLog(broken, { sampleReads: 1, flushMs: 60_000 });
  log.record(req());
  await log.flush();
  await log.stop();
});
