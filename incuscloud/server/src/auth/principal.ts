import { Elysia } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import { platformRoles, serviceAccounts, sessions, users } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { open, seal } from "../lib/secrets.ts";
import { log } from "../lib/log.ts";
import { SESSION_COOKIE, cookieOf, hashSessionId, type AuthDeps } from "./session.ts";

export type PlatformRole = "admin" | "operator" | "viewer";

/** Who is calling: a user (bearer token or browser session) or a service account. */
export interface Principal {
  kind: "user" | "service";
  id: string;
  email?: string;
  name: string;
  /** The access token to forward to clusters (spec D1). */
  token: string;
  platformRole?: PlatformRole;
  /** Service accounts may be bound to one tenant. */
  tenantId?: string | null;
}

const REFRESH_BEFORE_MS = 60_000;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function userPrincipal(deps: AuthDeps, userId: string, token: string): Promise<Principal | null> {
  if (!isUuid(userId)) return null;
  const [row] = await deps.db.select({ u: users, role: platformRoles.role }).from(users).leftJoin(platformRoles, eq(platformRoles.userId, users.id)).where(eq(users.id, userId));
  if (!row || row.u.disabled) return null;
  return { kind: "user", id: row.u.id, email: row.u.email, name: row.u.name, token, platformRole: (row.role as PlatformRole | null) ?? undefined };
}

/** Refreshes a session's tokens if they are about to expire; one refresher at a time per session. */
async function freshSession(deps: AuthDeps, id: string) {
  const { db } = deps;
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!row) return null;
  if (row.expiresAt.getTime() - Date.now() > REFRESH_BEFORE_MS) return row;
  // Hydra rotates refresh tokens and revokes the chain when an old one is
  // reused, so concurrent requests (any replica) must not refresh twice.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [cur] = await tx.select().from(sessions).where(eq(sessions.id, id));
    if (!cur) return null;
    if (cur.expiresAt.getTime() - Date.now() > REFRESH_BEFORE_MS) return cur;
    try {
      if (!cur.refreshToken) throw new Error("no refresh token");
      const set = await deps.tokens.refresh(open(deps.secretKey, cur.refreshToken));
      const [updated] = await tx
        .update(sessions)
        .set({ accessToken: set.accessToken, refreshToken: set.refreshToken ? seal(deps.secretKey, set.refreshToken) : cur.refreshToken, idToken: set.idToken ?? cur.idToken, expiresAt: new Date(Date.now() + set.expiresIn * 1000), lastSeenAt: new Date() })
        .where(eq(sessions.id, id))
        .returning();
      return updated ?? null;
    } catch (e) {
      log.info("session refresh failed; signing out", { error: String(e) });
      await tx.delete(sessions).where(eq(sessions.id, id));
      return null;
    }
  });
}

/** Resolves the caller from `Authorization: Bearer` or the session cookie. Invalid bearer tokens throw 401. */
export async function resolvePrincipal(deps: AuthDeps, request: Request): Promise<Principal | null> {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    const { sub } = await deps.verify(token);
    if (isUuid(sub)) return userPrincipal(deps, sub, token);
    const [sa] = await deps.db.select().from(serviceAccounts).where(and(eq(serviceAccounts.clientId, sub), eq(serviceAccounts.disabled, false)));
    return sa ? { kind: "service", id: sa.id, name: sa.name, token, tenantId: sa.tenantId } : null;
  }
  const sid = cookieOf(request, SESSION_COOKIE);
  if (!sid) return null;
  const row = await freshSession(deps, hashSessionId(sid));
  return row ? userPrincipal(deps, row.userId, row.accessToken) : null;
}

/** Adds `principal` (or null) to every request's context. */
export const principalPlugin = (deps: AuthDeps) =>
  new Elysia({ name: "principal" }).derive({ as: "global" }, async ({ request }) => ({ principal: await resolvePrincipal(deps, request) }));

/** Type-only companion for route modules: declares `principal` on the context. */
export const principalContext = new Elysia({ name: "principal-context" }).decorate("principal", null as Principal | null);

/** The principal, or 401. */
export function authed(p: Principal | null): Principal {
  if (!p) throw new ApiError(401, "unauthenticated", "Sign in first");
  return p;
}
