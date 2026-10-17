import type { Principal } from "../auth/principal.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { ApiError } from "../lib/errors.ts";
import type { Authz } from "./platform.ts";
import { PLATFORM } from "./platform.ts";

export const subject = (p: Principal) => `user:${p.id}`;

export const forbidden = () => new ApiError(403, "forbidden", "You do not have permission to do this");
export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);

export const can = (authz: Authz, p: Principal, relation: string, object: string) => authz.check(subject(p), relation, object);

/** 403 unless the principal has the relation. */
export async function need(authz: Authz, p: Principal, relation: string, object: string): Promise<void> {
  if (!(await can(authz, p, relation, object))) throw forbidden();
}

/** 404 unless the principal can at least see the object, then 403 unless it has the relation. */
export async function needVisible(authz: Authz, p: Principal, see: string, relation: string, object: string): Promise<void> {
  if (!(await can(authz, p, see, object))) throw notFound();
  if (relation !== see) await need(authz, p, relation, object);
}

/** 404 unless the principal may see `path`, then 403 unless it holds the privilege there. */
export async function needPriv(acl: Acl, p: Principal, privilege: Privilege, path: string, what = "Not found"): Promise<void> {
  if (!(await acl.sees(p, path))) throw notFound(what);
  if (!(await acl.can(p, privilege, path))) throw forbidden();
}

export const platformCan = (authz: Authz, p: Principal, relation: "admin" | "operator" | "viewer") => can(authz, p, relation, PLATFORM);
