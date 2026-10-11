import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { sessions, users } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { open, randomToken, seal } from "../lib/secrets.ts";
import { CLIENT_IP_HEADER } from "../front.ts";
import type { HydraAdminApi } from "../identity/hydra-admin.ts";
import { WEB_CLIENT_ID } from "../identity/bootstrap.ts";
import { AUDIENCE } from "../identity/routes.ts";
import { audit } from "../audit/log.ts";
import type { VerifyToken } from "./verify.ts";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
}

/** Hydra's token endpoint as the web (BFF) client uses it. */
export interface TokenEndpoint {
  exchange(code: string, verifier: string, redirectUri: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
}

export interface AuthDeps {
  db: Db;
  hydra: HydraAdminApi;
  tokens: TokenEndpoint;
  verify: VerifyToken;
  secretKey: Buffer;
  publicUrl: string;
  hydraPublicUrl: string;
  secureCookies: boolean;
}

export const SESSION_COOKIE = "ic_session";
const OAUTH_COOKIE = "ic_oauth";
const SESSION_MAX_AGE_S = 7 * 86400;

export const hashSessionId = (id: string) => createHash("sha256").update(id).digest("hex");

export const cookieOf = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** Only same-origin paths: `/x`, never `//host` or `/\host`. */
const safeReturnTo = (p: unknown) => (typeof p === "string" && /^\/(?![/\\])/.test(p) ? p : "/");

/** Hydra's token endpoint over HTTPS with the web client's credentials. */
export class HydraTokens implements TokenEndpoint {
  constructor(private readonly o: { hydraPublicUrl: string; clientSecret: string; ca?: string }) {}
  private async post(form: Record<string, string>): Promise<TokenSet> {
    const res = await fetch(`${this.o.hydraPublicUrl}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${encodeURIComponent(WEB_CLIENT_ID)}:${encodeURIComponent(this.o.clientSecret)}`)}` },
      body: new URLSearchParams(form),
      tls: this.o.ca ? { ca: this.o.ca } : undefined,
    } as RequestInit);
    const j = (await res.json().catch(() => ({}))) as Record<string, string | number>;
    if (!res.ok) throw new Error(`token endpoint: ${j.error ?? res.status} ${j.error_description ?? ""}`);
    return { accessToken: String(j.access_token), refreshToken: j.refresh_token as string | undefined, idToken: j.id_token as string | undefined, expiresIn: Number(j.expires_in ?? 3600) };
  }
  exchange(code: string, verifier: string, redirectUri: string) {
    return this.post({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  }
  refresh(refreshToken: string) {
    return this.post({ grant_type: "refresh_token", refresh_token: refreshToken });
  }
}

/** Browser sign-in (authorization code + PKCE), server-side sessions, sign-out (spec D10). */
export function sessionRoutes(deps: AuthDeps) {
  const { db, secretKey, secureCookies } = deps;
  const secure = secureCookies ? "; Secure" : "";
  const redirectUri = `${deps.publicUrl}/auth/callback`;
  const redirect = (to: string, cookies: string[] = [], status = 302) => {
    const h = new Headers({ location: to, "cache-control": "no-store" });
    for (const c of cookies) h.append("set-cookie", c);
    return new Response(null, { status, headers: h });
  };

  return new Elysia({ name: "sessions" })
    .get("/auth/start", ({ query }) => {
      const state = randomToken();
      const verifier = randomToken(48);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const sealed = seal(secretKey, JSON.stringify({ state, verifier, returnTo: safeReturnTo(query.return_to) }));
      const u = new URL(`${deps.hydraPublicUrl}/oauth2/auth`);
      u.search = new URLSearchParams({ client_id: WEB_CLIENT_ID, response_type: "code", scope: "openid offline_access email profile", redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256", audience: AUDIENCE }).toString();
      return redirect(u.toString(), [`${OAUTH_COOKIE}=${sealed}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`]);
    })
    .get("/auth/callback", async ({ query, request }) => {
      let pending: { state: string; verifier: string; returnTo: string };
      try {
        pending = JSON.parse(open(secretKey, cookieOf(request, OAUTH_COOKIE) ?? ""));
      } catch {
        throw new ApiError(400, "invalid_state", "This sign-in has expired. Start again.");
      }
      if (!query.state || query.state !== pending.state) throw new ApiError(400, "invalid_state", "This sign-in has expired. Start again.");
      if (query.error) throw new ApiError(403, "sign_in_failed", String(query.error_description ?? query.error));
      let set: TokenSet;
      try {
        set = await deps.tokens.exchange(String(query.code ?? ""), pending.verifier, redirectUri);
      } catch {
        throw new ApiError(400, "invalid_grant", "This sign-in has expired. Start again.");
      }
      const { sub } = await deps.verify(set.accessToken);
      const [user] = await db.select().from(users).where(eq(users.id, sub));
      if (!user || user.disabled) throw new ApiError(403, "account_disabled", "This account is disabled");
      const id = randomToken();
      await db.insert(sessions).values({
        id: hashSessionId(id),
        userId: user.id,
        accessToken: set.accessToken,
        refreshToken: set.refreshToken ? seal(secretKey, set.refreshToken) : null,
        idToken: set.idToken ?? null,
        expiresAt: new Date(Date.now() + set.expiresIn * 1000),
        userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300),
        ip: request.headers.get(CLIENT_IP_HEADER) ?? "",
      });
      await audit(db, { actor: { type: "user", id: user.id }, action: "auth.session.create", result: "success", ip: request.headers.get(CLIENT_IP_HEADER) ?? "" });
      return redirect(pending.returnTo, [
        `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`,
        `${OAUTH_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      ]);
    })
    // Hydra asks us to confirm a logout it started (RP-initiated or its own).
    .get("/auth/logout", async ({ query }) => {
      if (!query.logout_challenge) throw new ApiError(400, "invalid_request", "Sign out with POST /auth/logout");
      return redirect(await deps.hydra.acceptLogout(String(query.logout_challenge)));
    })
    // A POST, so other sites cannot sign users out (the session cookie is SameSite=Lax; Origin is checked).
    .post("/auth/logout", async ({ request }) => {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(deps.publicUrl).origin) throw new ApiError(403, "cross_origin", "Sign out from IncusCloud's own pages");
      const id = cookieOf(request, SESSION_COOKIE);
      let idToken: string | null = null;
      if (id) {
        const [row] = await db.delete(sessions).where(eq(sessions.id, hashSessionId(id))).returning();
        idToken = row?.idToken ?? null;
      }
      const u = new URL(`${deps.hydraPublicUrl}/oauth2/sessions/logout`);
      u.searchParams.set("post_logout_redirect_uri", `${deps.publicUrl}/`);
      if (idToken) u.searchParams.set("id_token_hint", idToken);
      return redirect(u.toString(), [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`], 303);
    });
}
