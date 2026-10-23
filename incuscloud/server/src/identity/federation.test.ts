import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { groupMappings, groupMembers, groups, identityProviders, userIdentities, users } from "../db/schema.ts";
import { seal } from "../lib/secrets.ts";
import { discover, finishSignIn, readFlight, resyncProvider, startSignIn, syncMappedGroups, userForUpstream, type IdentityProvider, type UpstreamClaims } from "./federation.ts";

const KEY = Buffer.alloc(32, 7);
const REDIRECT = "https://cloud.example/auth/federation/callback";

/**
 * A small OpenID provider: each issuer is a path on one server (discovery is cached per issuer),
 * with what its token endpoint answers set per test.
 */
interface Issuer {
  claims?: (nonce: string) => JWTPayload;
  /** Signs with another key than the one published. */
  forge?: boolean;
  userinfo?: Record<string, unknown>;
  tokenError?: string;
  basic?: boolean;
  /** What the token endpoint received. */
  seen?: { auth: string | null; form: URLSearchParams };
  nonce?: string;
}
const issuers = new Map<string, Issuer>();
let server: ReturnType<typeof Bun.serve>;
let base = "";
let signing: CryptoKey;
let other: CryptoKey;
let jwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signing = pair.privateKey as CryptoKey;
  other = (await generateKeyPair("RS256")).privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const [, name, ...rest] = url.pathname.split("/");
      const i = issuers.get(name!);
      if (!i) return new Response("no", { status: 404 });
      const iss = `${base}/${name}`;
      switch (rest.join("/")) {
        case ".well-known/openid-configuration":
          return Response.json({
            issuer: iss,
            authorization_endpoint: `${iss}/authorize`,
            token_endpoint: `${iss}/token`,
            jwks_uri: `${iss}/jwks`,
            userinfo_endpoint: `${iss}/userinfo`,
            token_endpoint_auth_methods_supported: i.basic === false ? ["client_secret_post"] : ["client_secret_basic"],
          });
        case "jwks":
          return Response.json({ keys: [jwk] });
        case "token": {
          i.seen = { auth: req.headers.get("authorization"), form: new URLSearchParams(await req.text()) };
          if (i.tokenError) return Response.json({ error: "invalid_grant", error_description: i.tokenError }, { status: 400 });
          const payload = i.claims!(i.nonce!);
          const id_token = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(i.forge ? other : signing);
          return Response.json({ id_token, access_token: "at-1", token_type: "Bearer" });
        }
        case "userinfo":
          return req.headers.get("authorization") === "Bearer at-1" ? Response.json(i.userinfo ?? {}) : new Response("no", { status: 401 });
      }
      return new Response("no", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

let db: Db;
let n = 0;
beforeEach(async () => {
  db = await testDb();
});

/** A provider row for a new issuer on the test server. */
async function provider(i: Issuer, over: Partial<typeof identityProviders.$inferInsert> = {}): Promise<IdentityProvider> {
  const name = `idp${++n}`;
  issuers.set(name, i);
  const [p] = await db
    .insert(identityProviders)
    .values({ slug: name, name: "Corp SSO", issuer: `${base}/${name}`, clientId: "incuscloud", clientSecretEnc: seal(KEY, "s3cret"), ...over })
    .returning();
  return p!;
}

const now = () => Math.floor(Date.now() / 1000);
const good = (p: IdentityProvider, extra: JWTPayload = {}) => (nonce: string) => ({ iss: p.issuer, aud: "incuscloud", sub: "alice-1", nonce, iat: now(), exp: now() + 300, email: "alice@corp.example", email_verified: true, name: "Alice", groups: ["eng"], ...extra });

/** Starts a sign-in, then finishes it with the code, the provider answering as the issuer is set. */
async function signIn(p: IdentityProvider) {
  const { location, flight } = await startSignIn(KEY, p, "challenge-1", REDIRECT);
  const params = new URL(location).searchParams;
  issuers.get(p.slug)!.nonce = params.get("nonce")!;
  const f = readFlight(KEY, flight, params.get("state")!);
  return finishSignIn(KEY, p, f, "code-1", REDIRECT);
}

test("discovery: the document must name the configured issuer and its endpoints", async () => {
  const doc = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
  await expect(discover("https://a.example/x", doc({ issuer: "https://evil.example", authorization_endpoint: "a", token_endpoint: "t", jwks_uri: "https://a.example/j" }))).rejects.toThrow("not an OpenID provider's for that issuer");
  await expect(discover("https://b.example", doc({ issuer: "https://b.example/" }))).rejects.toThrow("not an OpenID provider's");
  const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  await expect(discover("https://c.example", down)).rejects.toThrow("cannot be read: answered 503");
  // A trailing slash on either side is the same issuer.
  const ok = await discover("https://d.example/", doc({ issuer: "https://d.example", authorization_endpoint: "https://d.example/a", token_endpoint: "t", jwks_uri: "https://d.example/j" }));
  expect(ok.doc.authorization_endpoint).toBe("https://d.example/a");
});

test("the start: code flow with PKCE (S256), state and nonce; the flight is sealed and refused once altered, expired or for another state", async () => {
  const p = await provider({});
  const { location, flight } = await startSignIn(KEY, p, "challenge-1", REDIRECT);
  const url = new URL(location);
  expect(url.origin + url.pathname).toBe(`${p.issuer}/authorize`);
  const q = Object.fromEntries(url.searchParams);
  expect(q).toMatchObject({ response_type: "code", client_id: "incuscloud", redirect_uri: REDIRECT, scope: "openid email profile", code_challenge_method: "S256" });
  const f = readFlight(KEY, flight, q.state!);
  expect(f).toMatchObject({ provider: p.id, challenge: "challenge-1", state: q.state, nonce: q.nonce });
  expect(createHash("sha256").update(f.verifier).digest("base64url")).toBe(q.code_challenge!);
  expect(flight).not.toContain(f.verifier);

  expect(() => readFlight(KEY, flight, "other-state")).toThrow("expired");
  expect(() => readFlight(KEY, flight, "")).toThrow("expired");
  expect(() => readFlight(KEY, `${flight.slice(0, -4)}AAAA`, q.state!)).toThrow("expired");
  expect(() => readFlight(Buffer.alloc(32, 8), flight, q.state!)).toThrow("expired");
  expect(() => readFlight(KEY, undefined, q.state!)).toThrow("expired");
  const old = seal(KEY, JSON.stringify({ ...f, expires: Date.now() - 1 }));
  expect(() => readFlight(KEY, old, q.state!)).toThrow("expired");
});

test("the finish: the code and verifier go to the token endpoint with the client's secret; the ID token's claims come back", async () => {
  const i: Issuer = {};
  const p = await provider(i);
  i.claims = good(p);
  expect(await signIn(p)).toEqual({ sub: "alice-1", email: "alice@corp.example", emailVerified: true, name: "Alice", groups: ["eng"] });
  expect(i.seen!.auth).toBe(`Basic ${Buffer.from("incuscloud:s3cret").toString("base64")}`);
  expect(Object.fromEntries(i.seen!.form)).toMatchObject({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT });
  expect(i.seen!.form.get("code_verifier")).toHaveLength(64);
  expect(i.seen!.form.get("client_secret")).toBeNull();

  // A provider without client_secret_basic gets the secret in the form.
  const j: Issuer = { basic: false };
  const q = await provider(j);
  j.claims = good(q);
  await signIn(q);
  expect(j.seen!.auth).toBeNull();
  expect(j.seen!.form.get("client_secret")).toBe("s3cret");
});

test("an ID token is refused when forged, for another audience or issuer, expired, or for another sign-in's nonce", async () => {
  const cases: Array<[string, (p: IdentityProvider) => Issuer, string]> = [
    ["forged", (p) => ({ claims: good(p), forge: true }), "does not verify"],
    ["audience", (p) => ({ claims: good(p, { aud: "someone-else" }) }), "does not verify"],
    ["issuer", (p) => ({ claims: good(p, { iss: "https://evil.example" }) }), "does not verify"],
    ["expired", (p) => ({ claims: good(p, { iat: now() - 7200, exp: now() - 3600 }) }), "does not verify"],
    ["nonce", (p) => ({ claims: (_nonce: string) => good(p)("another-nonce") }), "is not for this sign-in"],
    ["no sub", (p) => ({ claims: good(p, { sub: undefined }) }), "is not for this sign-in"],
  ];
  for (const [what, make, message] of cases) {
    const i: Issuer = {};
    const p = await provider(i);
    Object.assign(i, make(p));
    await expect(signIn(p), what).rejects.toThrow(message);
  }
  const e: Issuer = { tokenError: "code already used" };
  await expect(signIn(await provider(e))).rejects.toThrow("Corp SSO refused the sign-in: code already used");
});

test("groups and email from userinfo when the token lacks them, only for the same subject; a single group as a string", async () => {
  const i: Issuer = { userinfo: { sub: "alice-1", email: "alice@corp.example", email_verified: "true", roles: "admins" } };
  const p = await provider(i, { groupsClaim: "roles" });
  i.claims = good(p, { email: undefined, email_verified: undefined, groups: undefined });
  expect(await signIn(p)).toMatchObject({ email: "alice@corp.example", emailVerified: true, groups: ["admins"] });

  const j: Issuer = { userinfo: { sub: "mallory", email: "boss@corp.example", email_verified: true, groups: ["admins"] } };
  const q = await provider(j);
  j.claims = good(q, { email: undefined, groups: undefined });
  expect(await signIn(q)).toMatchObject({ email: undefined, groups: [] });
});

const claims = (over: Partial<UpstreamClaims> = {}): UpstreamClaims => ({ sub: "alice-1", email: "alice@corp.example", emailVerified: true, name: "Alice", groups: [], ...over });

test("the account: linked by subject, else by a verified email (then linked), else created when the provider may", async () => {
  const p = await provider({});
  const [existing] = await db.insert(users).values({ email: "alice@corp.example", name: "Alice" }).returning();
  expect(await userForUpstream(db, p, claims({ emailVerified: false }))).toEqual({ ok: false, reason: "An IncusCloud account with alice@corp.example exists, but Corp SSO has not verified that address, so it cannot be linked." });
  expect(await userForUpstream(db, p, claims())).toMatchObject({ ok: true, userId: existing!.id, created: false });
  // Linked now: the subject finds it even with another (or no) email.
  expect(await userForUpstream(db, p, claims({ email: undefined }))).toMatchObject({ ok: true, userId: existing!.id });
  expect((await db.select().from(userIdentities))[0]).toMatchObject({ providerId: p.id, subject: "alice-1", userId: existing!.id });

  expect(await userForUpstream(db, p, claims({ sub: "bob-1", email: undefined }))).toMatchObject({ ok: false, reason: expect.stringContaining("did not tell IncusCloud your email") });
  const made = await userForUpstream(db, p, claims({ sub: "bob-1", email: "bob@corp.example", emailVerified: false, name: "Bob" }));
  expect(made).toMatchObject({ ok: true, created: true });
  expect((await db.select().from(users).where(eq(users.email, "bob@corp.example")))[0]).toMatchObject({ name: "Bob" });

  const closed = await provider({}, { createUsers: false });
  expect(await userForUpstream(db, closed, claims({ sub: "carol-1", email: "carol@corp.example" }))).toEqual({ ok: false, reason: "There is no IncusCloud account for carol@corp.example. Ask an administrator to create one." });

  await db.update(users).set({ disabled: true }).where(eq(users.id, existing!.id));
  expect(await userForUpstream(db, p, claims())).toEqual({ ok: false, reason: "This account is disabled" });
});

test("mapped groups follow the claim; memberships added by hand or by another provider stay", async () => {
  const p = await provider({});
  const q = await provider({});
  const [u] = await db.insert(users).values({ email: "alice@corp.example", name: "Alice" }).returning();
  const [eng, ops, manual] = await db.insert(groups).values([{ name: "eng" }, { name: "ops" }, { name: "manual" }]).returning();
  await db.insert(groupMappings).values([
    { providerId: p.id, claim: "engineering", groupId: eng!.id },
    { providerId: p.id, claim: "sre", groupId: ops!.id },
    { providerId: q.id, claim: "x", groupId: manual!.id },
  ]);
  await db.insert(groupMembers).values({ groupId: manual!.id, userId: u!.id });
  const mine = async () => (await db.select().from(groupMembers).where(eq(groupMembers.userId, u!.id))).map((m) => [m.groupId === eng!.id ? "eng" : m.groupId === ops!.id ? "ops" : "manual", m.providerId === p.id ? "p" : m.providerId ? "other" : "hand"]).sort();

  expect(await syncMappedGroups(db, p.id, u!.id, ["engineering", "sre", "unmapped"])).toBe(true);
  expect(await mine()).toEqual([["eng", "p"], ["manual", "hand"], ["ops", "p"]]);
  expect(await syncMappedGroups(db, p.id, u!.id, ["engineering", "sre"])).toBe(false);
  expect(await syncMappedGroups(db, p.id, u!.id, ["engineering"])).toBe(true);
  expect(await mine()).toEqual([["eng", "p"], ["manual", "hand"]]);
  // Provider q maps x to "manual", which alice already has by hand: nothing to add, and q's sync never removes it.
  expect(await syncMappedGroups(db, q.id, u!.id, [])).toBe(false);
  expect(await mine()).toEqual([["eng", "p"], ["manual", "hand"]]);

  // A changed mapping reaches everyone at once, from the groups each last brought.
  await db.insert(userIdentities).values({ providerId: p.id, subject: "alice-1", userId: u!.id, groups: ["engineering", "sre"] });
  expect(await resyncProvider(db, p.id)).toBe(true);
  expect(await mine()).toEqual([["eng", "p"], ["manual", "hand"], ["ops", "p"]]);
});
