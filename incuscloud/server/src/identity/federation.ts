import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Db } from "../db/index.ts";
import { groupMappings, groupMembers, identityProviders, userIdentities, users } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { open, randomToken, seal } from "../lib/secrets.ts";

/**
 * Sign-in through an upstream OpenID Connect provider (permissions phase 5):
 * authorization code with PKCE, the ID token checked against the provider's
 * keys, the account found by the provider's `sub` (or a verified email), and
 * the provider's groups claim mapped onto IncusCloud groups.
 */

export type IdentityProvider = typeof identityProviders.$inferSelect;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

const DISCOVERY_TTL_MS = 3600_000;
const discoveries = new Map<string, { at: number; doc: Discovery; jwks: JWTVerifyGetKey }>();

const bare = (issuer: string) => issuer.replace(/\/$/, "");

/** The provider's discovery document and keys, cached for an hour. */
export async function discover(issuer: string, fetchImpl: typeof fetch = fetch): Promise<{ doc: Discovery; jwks: JWTVerifyGetKey }> {
  const hit = discoveries.get(issuer);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit;
  let doc: Discovery;
  try {
    const res = await fetchImpl(`${bare(issuer)}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    doc = (await res.json()) as Discovery;
  } catch (e) {
    throw new ApiError(502, "idp_unreachable", `The identity provider's discovery document cannot be read: ${(e as Error).message}`);
  }
  // The provider must name itself as configured, or tokens would not verify.
  if (bare(doc.issuer ?? "") !== bare(issuer) || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new ApiError(502, "idp_invalid", `The discovery document at ${issuer} is not an OpenID provider's for that issuer`);
  }
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  discoveries.set(issuer, entry);
  return entry;
}

/** What the browser carries from the start to the callback, sealed with IncusCloud's key. */
interface Flight {
  provider: string;
  challenge: string;
  state: string;
  nonce: string;
  verifier: string;
  expires: number;
}

export const FLIGHT_COOKIE = "ic_federation";
const FLIGHT_S = 600;

const s256 = (v: string) => createHash("sha256").update(v).digest("base64url");

/** The provider's authorization URL for a Hydra login challenge, and the cookie that remembers it. */
export async function startSignIn(
  secretKey: Buffer,
  provider: IdentityProvider,
  challenge: string,
  redirectUri: string,
): Promise<{ location: string; flight: string }> {
  const { doc } = await discover(provider.issuer);
  const flight: Flight = { provider: provider.id, challenge, state: randomToken(), nonce: randomToken(), verifier: randomToken(48), expires: Date.now() + FLIGHT_S * 1000 };
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    scope: provider.scopes,
    state: flight.state,
    nonce: flight.nonce,
    code_challenge: s256(flight.verifier),
    code_challenge_method: "S256",
  }).toString();
  return { location: url.toString(), flight: seal(secretKey, JSON.stringify(flight)) };
}

export const flightCookie = (value: string, secure: boolean) =>
  // Lax: the provider sends the browser back with a top-level GET.
  `${FLIGHT_COOKIE}=${value}; Path=/auth/federation; HttpOnly; SameSite=Lax; Max-Age=${FLIGHT_S}${secure ? "; Secure" : ""}`;
export const clearFlightCookie = (secure: boolean) => `${FLIGHT_COOKIE}=; Path=/auth/federation; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

/** Reads the sealed flight back; anything altered, expired or for another state is refused. */
export function readFlight(secretKey: Buffer, sealed: string | undefined, state: string): Flight {
  let f: Flight;
  try {
    f = JSON.parse(open(secretKey, sealed ?? "")) as Flight;
  } catch {
    throw new ApiError(400, "federation_expired", "This sign-in has expired. Start again from your application.");
  }
  if (f.expires < Date.now() || !state || f.state !== state) throw new ApiError(400, "federation_expired", "This sign-in has expired. Start again from your application.");
  return f;
}

export interface UpstreamClaims {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  groups: string[];
}

const groupsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : typeof v === "string" && v ? [v] : []);

/** Exchanges the code, verifies the ID token, and reads the claims (from userinfo when the token lacks them). */
export async function finishSignIn(secretKey: Buffer, provider: IdentityProvider, flight: Flight, code: string, redirectUri: string): Promise<UpstreamClaims> {
  const { doc, jwks } = await discover(provider.issuer);
  const secret = open(secretKey, provider.clientSecretEnc);
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: flight.verifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const methods = doc.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  if (methods.includes("client_secret_basic")) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(provider.clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`;
  } else {
    form.set("client_id", provider.clientId);
    form.set("client_secret", secret);
  }
  const res = await fetch(doc.token_endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(15_000) });
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !tokens.id_token) {
    throw new ApiError(502, "idp_token", `${provider.name} refused the sign-in: ${tokens.error_description ?? tokens.error ?? `answered ${res.status}`}`);
  }
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(tokens.id_token, jwks, { issuer: [bare(provider.issuer), `${bare(provider.issuer)}/`], audience: provider.clientId, clockTolerance: 30 }));
  } catch (e) {
    throw new ApiError(502, "idp_token", `${provider.name}'s ID token does not verify: ${(e as Error).message}`);
  }
  if (claims.nonce !== flight.nonce || !claims.sub) throw new ApiError(502, "idp_token", `${provider.name}'s ID token is not for this sign-in`);
  let all: Record<string, unknown> = claims;
  // Many providers put groups and email only in userinfo.
  if ((claims[provider.groupsClaim] === undefined || claims.email === undefined) && doc.userinfo_endpoint && tokens.access_token) {
    const info: Record<string, unknown> = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : {}))
      .catch(() => ({}));
    if (info.sub === claims.sub) all = { ...info, ...claims };
  }
  return {
    sub: claims.sub,
    email: typeof all.email === "string" ? all.email : undefined,
    emailVerified: all.email_verified === true || all.email_verified === "true",
    name: [all.name, all.preferred_username, all.email].find((v): v is string => typeof v === "string" && !!v),
    groups: groupsOf(all[provider.groupsClaim]),
  };
}

/**
 * Makes `userId`'s memberships from this provider exactly what its mappings give for `claimed`;
 * memberships added by hand stay. True when anything changed.
 */
export async function syncMappedGroups(db: Db, providerId: string, userId: string, claimed: string[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rules = claimed.length ? await tx.select({ groupId: groupMappings.groupId }).from(groupMappings).where(and(eq(groupMappings.providerId, providerId), inArray(groupMappings.claim, claimed))) : [];
    const want = new Set(rules.map((r) => r.groupId));
    const mine = and(eq(groupMembers.userId, userId), isNull(groupMembers.serviceAccountId));
    const have = await tx.select({ groupId: groupMembers.groupId, providerId: groupMembers.providerId }).from(groupMembers).where(mine);
    const fromHere = new Set(have.filter((h) => h.providerId === providerId).map((h) => h.groupId));
    const any = new Set(have.map((h) => h.groupId));
    const drop = [...fromHere].filter((g) => !want.has(g));
    // A membership added by hand (or by another provider) already covers the group.
    const add = [...want].filter((g) => !any.has(g));
    if (drop.length) await tx.delete(groupMembers).where(and(mine, eq(groupMembers.providerId, providerId), inArray(groupMembers.groupId, drop)));
    if (add.length) await tx.insert(groupMembers).values(add.map((groupId) => ({ groupId, userId, providerId }))).onConflictDoNothing();
    return drop.length + add.length > 0;
  });
}

/** Re-applies a provider's mappings to everyone it signed in, from the groups each last brought. True when anything changed. */
export async function resyncProvider(db: Db, providerId: string): Promise<boolean> {
  const ids = await db.select({ userId: userIdentities.userId, groups: userIdentities.groups }).from(userIdentities).where(eq(userIdentities.providerId, providerId));
  let changed = false;
  for (const i of ids) changed = (await syncMappedGroups(db, providerId, i.userId, i.groups)) || changed;
  return changed;
}

export type SignInOutcome = { ok: true; userId: string; created: boolean; groupsChanged: boolean } | { ok: false; reason: string };

/**
 * The IncusCloud user for an upstream account: the one linked to it, else the user with its
 * verified email (then linked), else a new one when the provider creates users.
 */
export async function userForUpstream(db: Db, provider: IdentityProvider, c: UpstreamClaims): Promise<SignInOutcome> {
  const [linked] = await db.select({ userId: userIdentities.userId }).from(userIdentities).where(and(eq(userIdentities.providerId, provider.id), eq(userIdentities.subject, c.sub)));
  let userId = linked?.userId;
  let created = false;
  if (!userId) {
    if (!c.email) return { ok: false, reason: `${provider.name} did not tell IncusCloud your email address. Ask an administrator to add the email scope.` };
    const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, c.email));
    if (byEmail) {
      // Linking by an email the provider has not verified would let anyone claim any account.
      if (!c.emailVerified) return { ok: false, reason: `An IncusCloud account with ${c.email} exists, but ${provider.name} has not verified that address, so it cannot be linked.` };
      userId = byEmail.id;
    } else if (provider.createUsers) {
      const [u] = await db.insert(users).values({ email: c.email, name: (c.name ?? c.email).slice(0, 200) }).returning({ id: users.id });
      userId = u!.id;
      created = true;
    } else {
      return { ok: false, reason: `There is no IncusCloud account for ${c.email}. Ask an administrator to create one.` };
    }
    await db.insert(userIdentities).values({ providerId: provider.id, subject: c.sub, userId, groups: c.groups }).onConflictDoNothing();
  }
  const [user] = await db.select({ disabled: users.disabled }).from(users).where(eq(users.id, userId));
  if (!user || user.disabled) return { ok: false, reason: "This account is disabled" };
  const now = new Date();
  await db.update(userIdentities).set({ groups: c.groups, lastLoginAt: now }).where(and(eq(userIdentities.providerId, provider.id), eq(userIdentities.subject, c.sub)));
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
  const groupsChanged = await syncMappedGroups(db, provider.id, userId, c.groups);
  return { ok: true, userId, created, groupsChanged };
}

/** The enabled providers, for the sign-in page's buttons. */
export const enabledProviders = (db: Db) =>
  db.select({ slug: identityProviders.slug, name: identityProviders.name }).from(identityProviders).where(eq(identityProviders.enabled, true)).orderBy(identityProviders.name);
