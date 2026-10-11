import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { audit } from "../audit/log.ts";
import { ApiError } from "../lib/errors.ts";
import { randomToken } from "../lib/secrets.ts";
import { CLIENT_IP_HEADER } from "../front.ts";
import type { HydraAdminApi, HydraClientRef } from "./hydra-admin.ts";
import { checkCredentials } from "./passwords.ts";
import { devicePage, loginPage, messagePage } from "./pages.ts";
import { LoginThrottle } from "./throttle.ts";

export interface IdentityDeps {
  db: Db;
  hydra: HydraAdminApi;
  secureCookies: boolean;
}

/** Access tokens are for the cluster API; Incus checks this audience (spec D3). */
export const AUDIENCE = "incuscloud";
const REMEMBER_S = 8 * 3600;
const CSRF_COOKIE = "ic_csrf";

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'", ...headers } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });

const cookieOf = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const isFirstParty = (c: HydraClientRef) => c.metadata?.first_party === true;
const ipOf = (req: Request) => req.headers.get(CLIENT_IP_HEADER) ?? "";

/** Hydra's login, consent and device-verification pages (spec D2). */
export function identityRoutes({ db, hydra, secureCookies }: IdentityDeps) {
  const WINDOW_MS = 15 * 60_000;
  const perEmail = new LoginThrottle({ limit: 10, windowMs: WINDOW_MS });
  const perIp = new LoginThrottle({ limit: 50, windowMs: WINDOW_MS });
  const csrfCookie = (token: string) => `${CSRF_COOKIE}=${token}; Path=/auth; HttpOnly; SameSite=Strict; Max-Age=3600${secureCookies ? "; Secure" : ""}`;
  const withCsrf = (render: (csrf: string) => string, status = 200) => {
    const csrf = randomToken();
    return html(render(csrf), status, { "set-cookie": csrfCookie(csrf) });
  };
  const checkCsrf = (req: Request, form: Record<string, string>) => {
    const cookie = cookieOf(req, CSRF_COOKIE);
    if (!cookie || !form.csrf || cookie.length !== form.csrf.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(form.csrf))) {
      throw new ApiError(403, "csrf", "This form has expired. Go back and try again.");
    }
  };
  const errorPage = (e: unknown) => {
    if (e instanceof ApiError && e.status < 500) return html(messagePage("Cannot continue", e.message), e.status);
    throw e;
  };

  return new Elysia({ name: "identity" })
    .get("/auth/login", async ({ query, request }) => {
      try {
        const challenge = String(query.login_challenge ?? "");
        const login = await hydra.getLogin(challenge);
        if (login.skip) {
          const [user] = await db.select().from(users).where(eq(users.id, login.subject));
          if (!user || user.disabled) {
            await audit(db, { actor: { type: "user", id: login.subject }, action: "auth.login", result: "denied", detail: { reason: "remembered user disabled or removed" }, ip: ipOf(request) });
            return redirect(await hydra.rejectLogin(challenge, { error: "access_denied", error_description: "This account is disabled" }));
          }
          return redirect(await hydra.acceptLogin(challenge, { subject: login.subject, remember: true, remember_for: REMEMBER_S }));
        }
        return withCsrf((csrf) => loginPage({ challenge, csrf, client: login.client.client_name }));
      } catch (e) {
        return errorPage(e);
      }
    })
    .post("/auth/login", async ({ body, request }) => {
      const form = body as Record<string, string>;
      try {
        checkCsrf(request, form);
        const challenge = String(form.challenge ?? "");
        const login = await hydra.getLogin(challenge);
        const email = String(form.email ?? "");
        const emailKey = [email.trim().toLowerCase()];
        const ipKey = [ipOf(request)];
        const wait = Math.max(perEmail.retryAfterS(emailKey), perIp.retryAfterS(ipKey));
        if (wait > 0) {
          await audit(db, { actor: { type: "anonymous", id: email.slice(0, 200) }, action: "auth.login", result: "denied", detail: { reason: "throttled" }, ip: ipOf(request) });
          const minutes = Math.ceil(wait / 60);
          return html(messagePage("Too many attempts", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`), 429, { "retry-after": String(wait) });
        }
        const user = await checkCredentials(db, email, String(form.password ?? ""));
        if (!user) {
          perEmail.fail(emailKey);
          perIp.fail(ipKey);
          await audit(db, { actor: { type: "anonymous", id: email.slice(0, 200) }, action: "auth.login", result: "denied", ip: ipOf(request) });
          return withCsrf((csrf) => loginPage({ challenge, csrf, email, error: "Wrong email or password", client: login.client.client_name }), 401);
        }
        perEmail.clear(emailKey);
        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        await audit(db, { actor: { type: "user", id: user.id }, action: "auth.login", result: "success", detail: { client: login.client.client_id }, ip: ipOf(request) });
        return redirect(await hydra.acceptLogin(challenge, { subject: user.id, remember: true, remember_for: REMEMBER_S }));
      } catch (e) {
        return errorPage(e);
      }
    })
    .get("/auth/consent", async ({ query }) => {
      try {
        const challenge = String(query.consent_challenge ?? "");
        const consent = await hydra.getConsent(challenge);
        // Every client is ours (CLI, web, service accounts); others are refused.
        if (!isFirstParty(consent.client)) {
          return redirect(await hydra.rejectConsent(challenge, { error: "access_denied", error_description: "Unknown application" }));
        }
        const [user] = await db.select().from(users).where(eq(users.id, consent.subject));
        if (!user || user.disabled) {
          return redirect(await hydra.rejectConsent(challenge, { error: "access_denied", error_description: "This account is disabled" }));
        }
        const claims = { email: user.email, name: user.name };
        return redirect(
          await hydra.acceptConsent(challenge, {
            grant_scope: consent.requested_scope,
            grant_access_token_audience: [AUDIENCE],
            remember: true,
            remember_for: REMEMBER_S,
            session: { id_token: claims, access_token: claims },
          }),
        );
      } catch (e) {
        return errorPage(e);
      }
    })
    .get("/auth/device", ({ query }) => {
      const challenge = String(query.device_challenge ?? "");
      if (!challenge) return html(messagePage("Cannot continue", "Start from the command line tool: it shows the address and code to use."), 400);
      return withCsrf((csrf) => devicePage({ challenge, csrf, userCode: query.user_code ? String(query.user_code) : undefined }));
    })
    .post("/auth/device", async ({ body, request }) => {
      const form = body as Record<string, string>;
      try {
        checkCsrf(request, form);
        const challenge = String(form.challenge ?? "");
        const userCode = String(form.user_code ?? "").trim();
        try {
          return redirect(await hydra.acceptDevice(challenge, userCode));
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 400)) throw e;
          return withCsrf((csrf) => devicePage({ challenge, csrf, userCode, error: "That code is not valid or has expired. Check the command line tool." }), 400);
        }
      } catch (e) {
        return errorPage(e);
      }
    })
    .get("/auth/device/done", () => html(messagePage("Device connected", "You can close this window and return to the command line.")))
    .get("/auth/error", ({ query }) =>
      html(messagePage("Sign-in failed", String(query.error_description ?? query.error ?? "Something went wrong.")), 400),
    );
}
