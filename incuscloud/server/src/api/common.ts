import type { Principal } from "../auth/principal.ts";
import type { AuditEntry } from "../audit/log.ts";
import { audit } from "../audit/log.ts";
import type { Db } from "../db/index.ts";
import { ApiError } from "../lib/errors.ts";
import { CLIENT_IP_HEADER } from "../front.ts";

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Path ids that are not UUIDs can never match: 404 rather than a database error. */
export function uuidParam(id: string, what = "Not found"): string {
  if (!isUuid(id)) throw new ApiError(404, "not_found", what);
  return id;
}

/**
 * Runs a mutation and writes its audit row: success, denied (401/403/404)
 * or failure (anything else), then rethrows.
 */
export async function audited<T>(
  db: Db,
  ctx: { principal: Principal; request: Request },
  action: string,
  /** A target, or a function of the result for creations (undefined when it failed). */
  target: AuditEntry["target"] | ((r?: T) => AuditEntry["target"]),
  fn: () => Promise<T>,
  detail?: (r: T) => Record<string, unknown>,
): Promise<T> {
  const base = { actor: { type: ctx.principal.kind, id: ctx.principal.id }, action, ip: ctx.request.headers.get(CLIENT_IP_HEADER) ?? "" } as const;
  const t = (r?: T) => (typeof target === "function" ? target(r) : target);
  try {
    const r = await fn();
    await audit(db, { ...base, target: t(r), result: "success", detail: detail?.(r) });
    return r;
  } catch (e) {
    const denied = e instanceof ApiError && [401, 403, 404].includes(e.status);
    await audit(db, { ...base, target: t(), result: denied ? "denied" : "failure", detail: { error: (e as Error).message } });
    throw e;
  }
}

export const created = <T>(set: { status?: number | string }, body: T) => {
  set.status = 201;
  return body;
};
export const noContent = (set: { status?: number | string }) => {
  set.status = 204;
  return null;
};
