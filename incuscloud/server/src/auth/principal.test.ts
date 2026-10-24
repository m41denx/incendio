import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { platformRoles, serviceAccounts, sessions, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { seal } from "../lib/secrets.ts";
import { FakeHydra } from "../identity/fake-hydra.ts";
import { TEST_ISSUER, testKeys } from "../test/tokens.ts";
import { createVerifier } from "./verify.ts";
import { FakeTokens } from "./fake-tokens.ts";
import { resolvePrincipal } from "./principal.ts";
import type { AuthDeps } from "./session.ts";

const { jwks, sign } = await testKeys();
let db: Db;
let deps: AuthDeps;
let tokens: FakeTokens;
let userId: string;
const secretKey = Buffer.alloc(32, 6);

beforeEach(async () => {
  db = await testDb();
  tokens = new FakeTokens((c) => sign(c));
  deps = { db, hydra: new FakeHydra(), tokens, verify: createVerifier({ issuer: TEST_ISSUER, audience: "incuscloud", jwks }), secretKey, publicUrl: "https://cloud.test", hydraPublicUrl: "https://id.test", secureCookies: true };
  userId = (await db.insert(users).values({ email: "p@example.com", name: "P" }).returning())[0]!.id;
});

const bearer = async (sub: string) => new Request("https://cloud.test/api/v1/me", { headers: { authorization: `Bearer ${await sign({ sub })}` } });

test("bearer token of a user, with platform role", async () => {
  await db.insert(platformRoles).values({ userId, role: "operator" });
  const p = await resolvePrincipal(deps, await bearer(userId));
  expect(p).toMatchObject({ kind: "user", id: userId, email: "p@example.com", name: "P", platformRole: "operator" });
  expect(p!.token).toBeTruthy();
});

test("bearer token of a disabled or unknown user is not a principal", async () => {
  await db.update(users).set({ disabled: true }).where(eq(users.id, userId));
  expect(await resolvePrincipal(deps, await bearer(userId))).toBeNull();
  expect(await resolvePrincipal(deps, await bearer(crypto.randomUUID()))).toBeNull();
});

test("service accounts by client id; deleted or disabled ones are not principals", async () => {
  const [sa] = await db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-ci" }).returning();
  expect(await resolvePrincipal(deps, await bearer("sa-ci"))).toMatchObject({ kind: "service", id: sa!.id, name: "ci" });
  await db.update(serviceAccounts).set({ disabled: true });
  expect(await resolvePrincipal(deps, await bearer("sa-ci"))).toBeNull();
  await db.delete(serviceAccounts);
  expect(await resolvePrincipal(deps, await bearer("sa-ci"))).toBeNull();
});

test("an invalid bearer token is an error, not anonymous", async () => {
  const r = new Request("https://cloud.test/", { headers: { authorization: "Bearer junk" } });
  await expect(resolvePrincipal(deps, r)).rejects.toMatchObject({ status: 401 });
});

async function session(expiresInS: number, refreshToken = "rt-1") {
  const id = `sess-${crypto.randomUUID()}`;
  tokens.refreshable.set(refreshToken, userId);
  await db.insert(sessions).values({ id: createHash("sha256").update(id).digest("hex"), userId, accessToken: await sign({ sub: userId }), refreshToken: seal(secretKey, refreshToken), expiresAt: new Date(Date.now() + expiresInS * 1000) });
  return new Request("https://cloud.test/api/v1/me", { headers: { cookie: `other=1; ic_session=${id}` } });
}

test("session cookie resolves to its user", async () => {
  expect(await resolvePrincipal(deps, await session(3600))).toMatchObject({ kind: "user", id: userId });
});

test("a session about to expire is refreshed", async () => {
  const req = await session(30);
  const p = await resolvePrincipal(deps, req);
  expect(p?.id).toBe(userId);
  const [row] = await db.select().from(sessions);
  expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3000_000);
  expect(tokens.refreshable.has("rt-1")).toBe(false);
});

test("a session whose refresh fails is dropped", async () => {
  const req = await session(-10, "rt-revoked");
  tokens.refreshable.delete("rt-revoked");
  expect(await resolvePrincipal(deps, req)).toBeNull();
  expect(await db.select().from(sessions)).toEqual([]);
});

test("a session ends with its cookie's lifetime, however often its tokens were refreshed", async () => {
  const req = await session(3600);
  await db.update(sessions).set({ createdAt: new Date(Date.now() - 8 * 86400_000) });
  expect(await resolvePrincipal(deps, req)).toBeNull();
  expect(await db.select().from(sessions)).toEqual([]);
});

test("unknown session cookie and no credentials are anonymous", async () => {
  expect(await resolvePrincipal(deps, new Request("https://cloud.test/", { headers: { cookie: "ic_session=nope" } }))).toBeNull();
  expect(await resolvePrincipal(deps, new Request("https://cloud.test/"))).toBeNull();
});

test("parallel requests on an expiring session refresh it once", async () => {
  const req = await session(30, "rt-once");
  const results = await Promise.all(Array.from({ length: 5 }, () => resolvePrincipal(deps, req.clone() as Request)));
  expect(results.every((p) => p?.id === userId)).toBe(true);
  expect((await db.select().from(sessions)).length).toBe(1);
});

test("cookie-authenticated changes from another origin are refused", async () => {
  const { principalPlugin } = await import("./principal.ts");
  const { Elysia } = await import("elysia");
  const { errorHandling } = await import("../lib/errors.ts");
  const app = new Elysia().use(errorHandling).use(principalPlugin(deps)).post("/api/v1/x", ({ principal }) => ({ id: principal?.id }));
  const cookie = (await session(3600)).headers.get("cookie")!;
  const post = (headers: Record<string, string>) => app.handle(new Request("https://cloud.test/api/v1/x", { method: "POST", headers: { cookie, ...headers } }));
  expect((await post({ origin: "https://evil.test" })).status).toBe(403);
  expect((await post({ origin: "https://c1.cloud.test" })).status).toBe(403);
  expect((await post({ origin: "https://cloud.test" })).status).toBe(200);
  expect((await post({})).status).toBe(200); // non-browser clients send no Origin
  // Bearer tokens are not ambient credentials: no Origin rule.
  const bearer = await app.handle(new Request("https://cloud.test/api/v1/x", { method: "POST", headers: { authorization: `Bearer ${await sign({ sub: userId })}`, origin: "https://evil.test" } }));
  expect(bearer.status).toBe(200);
});
