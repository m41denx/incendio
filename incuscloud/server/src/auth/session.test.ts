import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { sessions, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { errorHandling } from "../lib/errors.ts";
import { FakeHydra } from "../identity/fake-hydra.ts";
import { TEST_ISSUER, testKeys } from "../test/tokens.ts";
import { createVerifier } from "./verify.ts";
import { FakeTokens } from "./fake-tokens.ts";
import { sessionRoutes, type AuthDeps } from "./session.ts";

const { jwks, sign } = await testKeys();
let db: Db;
let tokens: FakeTokens;
let hydra: FakeHydra;
let deps: AuthDeps;
let app: { handle(r: Request): Promise<Response> };
let userId: string;

beforeEach(async () => {
  db = await testDb();
  tokens = new FakeTokens((c) => sign(c));
  hydra = new FakeHydra();
  deps = { db, hydra, tokens, verify: createVerifier({ issuer: TEST_ISSUER, audience: "incuscloud", jwks }), secretKey: Buffer.alloc(32, 6), publicUrl: "https://cloud.test", hydraPublicUrl: "https://id.test", secureCookies: true };
  app = new Elysia().use(errorHandling).use(sessionRoutes(deps));
  userId = (await db.insert(users).values({ email: "s@example.com", name: "S" }).returning())[0]!.id;
});

const cookiesOf = (r: Response) => Object.fromEntries(r.headers.getSetCookie().map((c) => [c.split("=")[0]!, c]));
const valueOf = (c: string) => c.split(";")[0]!.split("=").slice(1).join("=");

async function start(returnTo = "/clusters") {
  const r = await app.handle(new Request(`https://cloud.test/auth/start?return_to=${encodeURIComponent(returnTo)}`));
  const loc = new URL(r.headers.get("location")!);
  return { r, loc, oauthCookie: cookiesOf(r).ic_oauth! };
}

async function login(returnTo = "/clusters") {
  const { loc, oauthCookie } = await start(returnTo);
  tokens.codes.set("CODE", { sub: userId, verifier: "" });
  // The fake checks the PKCE verifier: learn it from the exchange instead of the sealed cookie.
  const realExchange = tokens.exchange.bind(tokens);
  tokens.exchange = (code, verifier, uri) => {
    tokens.codes.get(code)!.verifier = verifier;
    return realExchange(code, verifier, uri);
  };
  return app.handle(new Request(`https://cloud.test/auth/callback?code=CODE&state=${loc.searchParams.get("state")}`, { headers: { cookie: `ic_oauth=${valueOf(oauthCookie)}` } }));
}

test("start redirects to Hydra with PKCE, state and the incuscloud audience", async () => {
  const { r, loc, oauthCookie } = await start();
  expect(r.status).toBe(302);
  expect(loc.origin + loc.pathname).toBe("https://id.test/oauth2/auth");
  expect(loc.searchParams.get("client_id")).toBe("incuscloud-web");
  expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
  expect(loc.searchParams.get("audience")).toBe("incuscloud");
  expect(loc.searchParams.get("redirect_uri")).toBe("https://cloud.test/auth/callback");
  expect(loc.searchParams.get("state")!.length).toBeGreaterThan(20);
  expect(oauthCookie).toContain("HttpOnly");
  expect(oauthCookie).toContain("Secure");
});

test("callback creates a session (hashed id, sealed refresh token) and returns to the app", async () => {
  const r = await login("/clusters/c1");
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe("/clusters/c1");
  const cookie = cookiesOf(r).ic_session!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  const id = valueOf(cookie);
  const [row] = await db.select().from(sessions);
  expect(row!.id).toBe(createHash("sha256").update(id).digest("hex"));
  expect(row!.userId).toBe(userId);
  expect(row!.refreshToken).toStartWith("v1.");
  expect(tokens.exchanged[0]!.verifier.length).toBeGreaterThan(40);
});

test("callback with a wrong state or no cookie is refused", async () => {
  const { oauthCookie } = await start();
  const r = await app.handle(new Request("https://cloud.test/auth/callback?code=CODE&state=forged", { headers: { cookie: `ic_oauth=${valueOf(oauthCookie)}` } }));
  expect(r.status).toBe(400);
  const r2 = await app.handle(new Request("https://cloud.test/auth/callback?code=CODE&state=x"));
  expect(r2.status).toBe(400);
  expect(await db.select().from(sessions)).toEqual([]);
});

test("return_to only allows local paths", async () => {
  for (const evil of ["//evil.test/x", "https://evil.test/", "/\\evil.test"]) {
    expect((await login(evil)).headers.get("location")).toBe("/");
  }
});

test("callback refuses a token whose subject is not a user id", async () => {
  userId = "client-credentials-app";
  const r = await login();
  expect(r.status).toBe(403);
  expect(await db.select().from(sessions)).toEqual([]);
});

test("callback refuses tokens for unknown or disabled users", async () => {
  await db.update(users).set({ disabled: true }).where(eq(users.id, userId));
  const r = await login();
  expect(r.status).toBe(403);
  expect(await db.select().from(sessions)).toEqual([]);
});

test("logout removes the session and goes through Hydra's logout", async () => {
  const id = valueOf(cookiesOf(await login()).ic_session!);
  const r = await app.handle(new Request("https://cloud.test/auth/logout", { method: "POST", headers: { cookie: `ic_session=${id}`, origin: "https://cloud.test" } }));
  expect(r.status).toBe(303);
  const loc = new URL(r.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe("https://id.test/oauth2/sessions/logout");
  expect(loc.searchParams.get("post_logout_redirect_uri")).toBe("https://cloud.test/");
  expect(cookiesOf(r).ic_session).toContain("Max-Age=0");
  expect(await db.select().from(sessions)).toEqual([]);
});

test("logout is a same-origin POST: other sites cannot sign users out, GET does not", async () => {
  const id = valueOf(cookiesOf(await login()).ic_session!);
  const cross = await app.handle(new Request("https://cloud.test/auth/logout", { method: "POST", headers: { cookie: `ic_session=${id}`, origin: "https://evil.test" } }));
  expect(cross.status).toBe(403);
  const get = await app.handle(new Request("https://cloud.test/auth/logout", { headers: { cookie: `ic_session=${id}` } }));
  expect(get.status).toBe(400);
  expect((await db.select().from(sessions)).length).toBe(1);
});

test("Hydra's logout challenge is accepted", async () => {
  hydra.logouts.add("LO1");
  const r = await app.handle(new Request("https://cloud.test/auth/logout?logout_challenge=LO1"));
  expect(r.headers.get("location")).toBe("https://hydra.test/after-logout?ch=LO1");
});
