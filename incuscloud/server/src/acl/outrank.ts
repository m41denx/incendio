import type { Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { subjectOf, type Acl } from "./acl.ts";

/**
 * Refuses a change at `path` that reaches someone above the caller: a
 * subject (or, for an entry being removed, its author) holding there or
 * above a privilege the caller lacks at `path`, or a tenant owner when the
 * caller is neither an owner of that tenant nor a user administrator. So a
 * tenant admin can narrow its tenant's members but never platform staff or
 * the owner.
 */
export async function needOutrank(acl: Acl, caller: Principal, path: string, subjects: string[]): Promise<void> {
  const me = subjectOf(caller);
  const mine = await acl.privileges(caller, path);
  for (const s of subjects) {
    if (s === me) continue;
    for (const p of await acl.reach(s, path)) if (!mine.has(p)) throw new ApiError(403, "outranked", "They hold rights here that you do not; ask a platform administrator");
  }
  const slug = /^\/tenants\/([^/]+)/.exec(path)?.[1];
  if (!slug) return;
  const l = await acl.lookup();
  const tenantId = [...l.tenantSlugs].find(([, x]) => x === slug)?.[0];
  const owner = (s: string) => !!tenantId && s.startsWith("user:") && l.owners.has(`${tenantId}:${s.slice(5)}`);
  if (subjects.some((s) => s !== me && owner(s)) && !owner(me) && !(await acl.can(caller, "platform.users", "/"))) {
    throw new ApiError(403, "outranked", "Only the tenant's owners and platform administrators change what its owners get");
  }
}
