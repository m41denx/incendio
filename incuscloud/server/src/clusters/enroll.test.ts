import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { clusters } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { open } from "../lib/secrets.ts";
import { enrollCluster, clusterClient } from "./enroll.ts";
import { FakeIncus } from "./fake-incus.ts";

const secretKey = Buffer.alloc(32, 3);
let fake: FakeIncus;
let db: Db;
beforeAll(async () => {
  fake = await new FakeIncus().start();
  db = await testDb();
});
afterAll(() => fake.stop());

test("enrolment trusts our certificate and stores the pinned cluster", async () => {
  const token = fake.token();
  const row = await enrollCluster({ db, secretKey }, { name: "c1", token: `${token}\n`, labels: { region: "eu" } });
  expect(row.status).toBe("ready");
  expect(row.url).toBe(`https://127.0.0.1:${fake.port}`);
  expect(row.labels).toEqual({ region: "eu" });
  const posted = fake.certificatesPosted.at(-1)!;
  expect(posted.body).toMatchObject({ type: "client", trust_token: token, name: "incuscloud" });
  expect(posted.clientFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(open(secretKey, row.clientKeyEnc)).toContain("PRIVATE KEY");
  // The stored identity works for later admin calls.
  const server = await clusterClient({ secretKey }, row).server();
  expect(server.auth).toBe("trusted");
});

test("a wrong trust token is refused and nothing is stored", async () => {
  await expect(enrollCluster({ db, secretKey }, { name: "c2", token: fake.token({ secret: "nope" }) })).rejects.toThrow(/refused the trust token/);
  expect(await db.select().from(clusters).where(eq(clusters.name, "c2"))).toEqual([]);
});

test("a token whose fingerprint does not match the server is refused before anything is sent", async () => {
  const before = fake.certificatesPosted.length;
  await expect(enrollCluster({ db, secretKey }, { name: "c3", token: fake.token({ fingerprint: "00".repeat(32) }) })).rejects.toThrow(/does not match/);
  expect(fake.certificatesPosted.length).toBe(before);
});

test("duplicate names are rejected", async () => {
  await expect(enrollCluster({ db, secretKey }, { name: "c1", token: fake.token() })).rejects.toThrow(/already exists/);
});

test("Incus errors surface with their message", async () => {
  const [row] = await db.select().from(clusters).where(eq(clusters.name, "c1"));
  await expect(clusterClient({ secretKey }, row!).request("GET", "/1.0/boom")).rejects.toThrow(/kaboom/);
});

test("an unreachable first address does not delay enrolment", async () => {
  const token = fake.token({ addresses: ["10.255.255.1:8443", `127.0.0.1:${fake.port}`] });
  const t0 = Date.now();
  const row = await enrollCluster({ db, secretKey }, { name: "c5", token });
  expect(Date.now() - t0).toBeLessThan(3000);
  expect(row.url).toBe(`https://127.0.0.1:${fake.port}`);
});

test("unreachable addresses fail clearly", async () => {
  const token = Buffer.from(JSON.stringify({ client_name: "x", fingerprint: "ab".repeat(32), addresses: ["127.0.0.1:1"], secret: "s", expires_at: "2099-01-01T00:00:00Z" })).toString("base64");
  await expect(enrollCluster({ db, secretKey }, { name: "c4", token })).rejects.toThrow(/Could not reach/);
});
